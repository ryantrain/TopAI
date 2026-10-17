"""Small JSON-only adapters. Provider credentials never enter market state."""
import json
import math
import os
import re

import httpx

KEYS = {'openai': 'OPENAI_API_KEY', 'gemini': 'GEMINI_API_KEY', 'anthropic': 'ANTHROPIC_API_KEY', 'ollama': None}
DEFAULT_MODELS = {'openai': 'gpt-4.1-mini', 'gemini': 'gemini-3.8-flash', 'anthropic': 'claude-sonnet-4-6', 'ollama': 'qwen2.5:7b'}


def model_for(provider):
    return os.getenv({'openai': 'OPENAI_MODEL', 'gemini': 'GEMINI_MODEL', 'anthropic': 'ANTHROPIC_MODEL', 'ollama': 'OLLAMA_MODEL'}[provider], DEFAULT_MODELS[provider])


def configuration():
    workers = [p.strip().lower() for p in os.getenv('WORKER_PROVIDERS', 'openai,gemini,openai').split(',')]
    models = [m.strip() for m in os.getenv('WORKER_MODELS', '').split(',')]
    rates = os.getenv('WORKER_COST_PER_1K_TOKENS', ',,').split(',')
    try:
        rates = [float(rate) if rate.strip() else None for rate in rates]
        if len(rates) != 3 or any(rate is not None and (not math.isfinite(rate) or rate < 0) for rate in rates):
            raise ValueError
    except ValueError:
        raise ValueError('WORKER_COST_PER_1K_TOKENS must contain three nonnegative USD rates or blank entries') from None
    trader = os.getenv('TRADER_PROVIDER', 'gemini').strip().lower()
    analyst = os.getenv('ANALYST_PROVIDER', 'gemini').strip().lower()
    if len(workers) != 3 or any(p not in KEYS for p in workers + [trader, analyst]):
        raise ValueError('Choose exactly three WORKER_PROVIDERS and supported trader/analyst providers: openai, gemini, anthropic, ollama')
    return dict(cost_per_1k_tokens=rates, workers=[dict(provider=p, model=models[i] if i < len(models) and models[i] else model_for(p)) for i, p in enumerate(workers)],
                trader=dict(provider=trader, model=os.getenv('TRADER_MODEL') or model_for(trader)),
                analyst=dict(provider=analyst, model=os.getenv('ANALYST_MODEL') or model_for(analyst)))


def readiness(config):
    providers = {s['provider'] for s in config['workers'] + [config['trader'], config['analyst']]}
    return [KEYS[p] for p in sorted(providers) if KEYS[p] and not os.getenv(KEYS[p])]


def parse_object(raw):
    # Claude may wrap JSON in a markdown fence despite the instruction.
    raw = raw.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw)
    def reject_constant(value):
        raise ValueError(f'Invalid JSON constant: {value}')
    result = json.loads(raw, parse_constant=reject_constant)
    if not isinstance(result, dict):
        raise ValueError('Expected a JSON object')
    return result


async def ask(prompt, instruction, model=None, provider='openai', with_usage=False, schema=None):
    if provider not in KEYS:
        raise ValueError('Unsupported model provider')
    if attachment and provider != 'gemini':
        raise ValueError('File attachments are only supported for Gemini')
    if provider == 'ollama':
        return await ask_local(prompt, instruction, model or model_for(provider), with_usage, schema)
    key = os.getenv(KEYS[provider])
    if not key:
        raise ValueError(f'Missing {KEYS[provider]}')
    model = model or model_for(provider)
    instruction += ' Return only valid JSON. No markdown.'
    if provider == 'openai':
        from openai import AsyncOpenAI
        async with AsyncOpenAI(api_key=key, timeout=75, max_retries=1) as client:
            response = await client.responses.create(
                model=model, instructions=instruction, input=prompt,
                text={'format': {'type': 'json_object'}}, max_output_tokens=4096,
            )
        result = parse_object(response.output_text)
        if with_usage:
            result['_total_tokens'] = response.usage.total_tokens if response.usage else None
        return result

    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == 'gemini':
            # A model is a single URL path segment, never a user-supplied host.
            if not re.fullmatch(r'[a-zA-Z0-9._-]+', model):
                raise ValueError('Invalid Gemini model name')
            response = await client.post(
                f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                headers={'x-goog-api-key': key},
                json={'systemInstruction': {'parts': [{'text': instruction}]},
                      # An attachment is {'mime_type', 'data' (base64)} and is read before the prompt.
                      'contents': [{'role': 'user', 'parts': ([{'inline_data': attachment}] if attachment else []) + [{'text': prompt}]}],
                      'generationConfig': {'responseMimeType': 'application/json', 'maxOutputTokens': max_tokens}},
            )
            response.raise_for_status()
            data = response.json()
            total_tokens = data.get('usageMetadata', {}).get('totalTokenCount')
            candidates = data.get('candidates', [])
            if not candidates or candidates[0].get('finishReason') != 'STOP':
                raise ValueError('Gemini did not return a complete answer')
            raw = ''.join(p.get('text', '') for p in candidates[0].get('content', {}).get('parts', []) if not p.get('thought'))
        else:
            response = await client.post(
                'https://api.anthropic.com/v1/messages',
                headers={'x-api-key': key, 'anthropic-version': '2023-06-01'},
                json={'model': model, 'max_tokens': 4096, 'system': instruction,
                      'messages': [{'role': 'user', 'content': prompt}]},
            )
            response.raise_for_status()
            data = response.json()
            usage = data.get('usage', {})
            total_tokens = sum(usage.get(k, 0) for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')) or None
            if data.get('stop_reason') != 'end_turn':
                raise ValueError('Claude did not return a complete answer')
            raw = ''.join(p.get('text', '') for p in data.get('content', []) if p.get('type') == 'text')
    result = parse_object(raw)
    if with_usage:
        result['_total_tokens'] = total_tokens
    return result


async def local_models_ready(models):
    if any(not model or 'cloud' in model.lower() for model in models):
        raise ValueError('Choose installed local Ollama models, without cloud routing.')
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        response = await client.get('http://127.0.0.1:11434/api/tags')
        response.raise_for_status()
        installed = {m['name'] for m in response.json().get('models', [])}
    missing = [m for m in set(models) if m not in installed and m + ':latest' not in installed]
    if missing:
        raise ValueError('Download these local Ollama models first: ' + ', '.join(sorted(missing)))


async def ask_local(prompt, instruction, model, with_usage=False, schema=None):
    if not model or 'cloud' in model.lower():
        raise ValueError('Choose an installed local Ollama model, without cloud routing.')
    async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
        response = await client.post('http://127.0.0.1:11434/api/chat', json={
            'model': model, 'stream': False, 'format': schema if schema is not None else 'json', 'options': {'temperature': 0, 'num_predict': 8192},
            'messages': [{'role': 'system', 'content': instruction + ' Return only valid JSON.'},
                         {'role': 'user', 'content': prompt}],
        })
        response.raise_for_status()
        data = response.json()
    if data.get('done') is not True or data.get('done_reason', 'stop') != 'stop':
        raise ValueError('Local model did not return a complete answer')
    result = parse_object(data['message']['content'])
    if with_usage:
        counts = [data.get('prompt_eval_count'), data.get('eval_count')]
        result['_total_tokens'] = sum(counts) if all(type(c) is int and c >= 0 for c in counts) else None
    return result
