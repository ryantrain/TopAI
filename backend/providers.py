"""Small JSON-only adapters. Provider credentials never enter session state."""
import json
import math
import os
import re
import secrets

import httpx

KEYS = {'openai': 'OPENAI_API_KEY', 'gemini': 'GEMINI_API_KEY', 'anthropic': 'ANTHROPIC_API_KEY', 'ollama': None}
DEFAULT_MODELS = {'openai': 'gpt-4o-mini', 'gemini': 'gemini-2.5-flash-lite', 'anthropic': 'claude-sonnet-4-6', 'ollama': 'qwen2.5:7b'}
_runtime_configuration = None
_runtime_keys = {}


class ProviderResponseError(ValueError):
    """A provider returned an unusable response; never include its raw text."""


def model_for(provider):
    return os.getenv({'openai': 'OPENAI_MODEL', 'gemini': 'GEMINI_MODEL', 'anthropic': 'ANTHROPIC_MODEL', 'ollama': 'OLLAMA_MODEL'}[provider], DEFAULT_MODELS[provider])


def configuration():
    if _runtime_configuration is not None:
        return dict(cost_per_1k_tokens=list(_runtime_configuration['cost_per_1k_tokens']),
                    workers=[dict(worker) for worker in _runtime_configuration['workers']])
    workers = [p.strip().lower() for p in os.getenv('WORKER_PROVIDERS', 'openai,gemini,openai').split(',')]
    models = [m.strip() for m in os.getenv('WORKER_MODELS', '').split(',')]
    raw_rates = os.getenv('WORKER_COST_PER_1K_TOKENS', '')
    rates = raw_rates.split(',') if raw_rates else [''] * len(workers)
    try:
        rates = [float(rate) if rate.strip() else None for rate in rates]
        if len(rates) != len(workers) or any(rate is not None and (not math.isfinite(rate) or rate < 0) for rate in rates):
            raise ValueError
    except ValueError:
        raise ValueError('WORKER_COST_PER_1K_TOKENS must contain one nonnegative USD rate or blank entry per worker') from None
    if not 1 <= len(workers) <= 6 or any(not p or p not in KEYS for p in workers):
        raise ValueError('Choose one to six WORKER_PROVIDERS: openai, gemini, anthropic, ollama')
    return dict(cost_per_1k_tokens=rates, workers=[dict(provider=p, model=models[i] if i < len(models) and models[i] else model_for(p)) for i, p in enumerate(workers)],
                )


def configure_agents(slots):
    """Install UI-supplied worker credentials in process memory only."""
    global _runtime_configuration, _runtime_keys
    if not 1 <= len(slots) <= 6:
        raise ValueError('Configure one to six agents')
    previous_workers = _runtime_configuration['workers'] if _runtime_configuration else []
    previous_keys = _runtime_keys
    keys = {}
    workers = []
    for index, slot in enumerate(slots, 1):
        provider = str(slot.get('provider', '')).strip().lower()
        model = str(slot.get('model', '')).strip()
        key = str(slot.get('api_key', '')).strip()
        if provider not in KEYS:
            raise ValueError(f'Agent {index}: choose openai, gemini, anthropic, or ollama')
        if not model or len(model) > 200:
            raise ValueError(f'Agent {index}: enter a model name')
        worker = dict(provider=provider, model=model)
        if provider != 'ollama':
            if key:
                credential_id = secrets.token_urlsafe(18)
                keys[credential_id] = key
                worker['credential_id'] = credential_id
            elif not os.getenv(KEYS[provider], '').strip():
                previous = previous_workers[index - 1] if index <= len(previous_workers) else {}
                credential_id = previous.get('credential_id') if previous.get('provider') == provider else None
                if not credential_id or credential_id not in previous_keys:
                    raise ValueError(f'Agent {index}: enter an API key for {provider}')
                keys[credential_id] = previous_keys[credential_id]
                worker['credential_id'] = credential_id
        workers.append(worker)
    _runtime_keys = keys
    _runtime_configuration = dict(cost_per_1k_tokens=[None] * len(workers), workers=workers)
    return configuration()


def clear_agent_configuration():
    global _runtime_configuration, _runtime_keys
    _runtime_configuration = None
    _runtime_keys = {}


def public_configuration(config):
    return dict(cost_per_1k_tokens=list(config['cost_per_1k_tokens']),
                workers=[{key: value for key, value in worker.items() if key != 'credential_id'}
                         for worker in config['workers']])


def runtime_configuration_active():
    return _runtime_configuration is not None


def readiness(config):
    missing = []
    for index, slot in enumerate(config['workers'], 1):
        provider = slot['provider']
        credential = slot.get('credential_id')
        if KEYS[provider] and not (_runtime_keys.get(credential) or os.getenv(KEYS[provider], '').strip()):
            missing.append(f'agent {index} {KEYS[provider]}')
    return missing


def parse_object(raw):
    # Small models may wrap JSON in a fence or one short line of prose.
    raw = raw.strip().lstrip('\ufeff')
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw)
    def reject_constant(value):
        raise ValueError(f'Invalid JSON constant: {value}')
    try:
        result = json.loads(raw, parse_constant=reject_constant)
    except json.JSONDecodeError:
        start, end = raw.find('{'), raw.rfind('}')
        if start < 0 or end <= start:
            raise
        result = json.loads(raw[start:end + 1], parse_constant=reject_constant)
    if not isinstance(result, dict):
        raise ValueError('Expected a JSON object')
    return result


def parse_provider_object(raw, provider, model):
    try:
        return parse_object(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        label = {'openai': 'OpenAI', 'gemini': 'Gemini', 'anthropic': 'Anthropic', 'ollama': 'Ollama'}.get(provider, provider)
        raise ProviderResponseError(f'{label} model {model} returned invalid JSON') from None


async def ask(prompt, instruction, model=None, provider='openai', with_usage=False, schema=None,
              attachment=None, max_tokens=8192, timeout=90, credential_id=None):
    if provider not in KEYS:
        raise ValueError('Unsupported model provider')
    if attachment and provider != 'gemini':
        raise ValueError('File attachments are only supported for Gemini')
    if provider == 'ollama':
        return await ask_local(prompt, instruction, model or model_for(provider), with_usage, schema)
    key = _runtime_keys.get(credential_id) or os.getenv(KEYS[provider])
    if not key:
        raise ValueError(f'Missing {KEYS[provider]}')
    model = model or model_for(provider)
    instruction += ' Return only valid JSON. No markdown.'
    if provider == 'openai':
        from openai import AsyncOpenAI
        async with AsyncOpenAI(api_key=key, timeout=75, max_retries=1) as client:
            response = await client.responses.create(
                model=model, instructions=instruction, input='JSON input:\n' + prompt,
                text={'format': {'type': 'json_object'}}, max_output_tokens=4096,
            )
        result = parse_provider_object(response.output_text, provider, model)
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
    result = parse_provider_object(raw, provider, model)
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
    result = parse_provider_object(data['message']['content'], 'ollama', model)
    if with_usage:
        counts = [data.get('prompt_eval_count'), data.get('eval_count')]
        result['_total_tokens'] = sum(counts) if all(type(c) is int and c >= 0 for c in counts) else None
    return result
