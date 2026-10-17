"""Small JSON-only adapters. Provider credentials never enter market state."""
import json
import os
import re

import httpx

KEYS = {'openai': 'OPENAI_API_KEY', 'gemini': 'GEMINI_API_KEY', 'anthropic': 'ANTHROPIC_API_KEY'}
DEFAULT_MODELS = {'openai': 'gpt-4.1-mini', 'gemini': 'gemini-3.8-flash', 'anthropic': 'claude-sonnet-4-6'}


def model_for(provider):
    return os.getenv({'openai': 'OPENAI_MODEL', 'gemini': 'GEMINI_MODEL', 'anthropic': 'ANTHROPIC_MODEL'}[provider], DEFAULT_MODELS[provider])


def configuration():
    workers = [p.strip().lower() for p in os.getenv('WORKER_PROVIDERS', 'openai,gemini,openai').split(',')]
    models = [m.strip() for m in os.getenv('WORKER_MODELS', '').split(',')]
    trader = os.getenv('TRADER_PROVIDER', 'gemini').strip().lower()
    analyst = os.getenv('ANALYST_PROVIDER', 'gemini').strip().lower()
    if len(workers) != 3 or any(p not in KEYS for p in workers + [trader, analyst]):
        raise ValueError('Choose exactly three WORKER_PROVIDERS and supported trader/analyst providers: openai, gemini, anthropic')
    return dict(workers=[dict(provider=p, model=models[i] if i < len(models) and models[i] else model_for(p)) for i, p in enumerate(workers)],
                trader=dict(provider=trader, model=os.getenv('TRADER_MODEL') or model_for(trader)),
                analyst=dict(provider=analyst, model=os.getenv('ANALYST_MODEL') or model_for(analyst)))


def readiness(config):
    providers = {s['provider'] for s in config['workers'] + [config['trader'], config['analyst']]}
    return [KEYS[p] for p in sorted(providers) if not os.getenv(KEYS[p])]


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


async def ask(prompt, instruction, model=None, provider='openai'):
    if provider not in KEYS:
        raise ValueError('Unsupported model provider')
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
        return parse_object(response.output_text)

    async with httpx.AsyncClient(timeout=90) as client:
        if provider == 'gemini':
            # A model is a single URL path segment, never a user-supplied host.
            if not re.fullmatch(r'[a-zA-Z0-9._-]+', model):
                raise ValueError('Invalid Gemini model name')
            response = await client.post(
                f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                headers={'x-goog-api-key': key},
                json={'systemInstruction': {'parts': [{'text': instruction}]},
                      'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                      'generationConfig': {'responseMimeType': 'application/json', 'maxOutputTokens': 8192}},
            )
            response.raise_for_status()
            candidates = response.json().get('candidates', [])
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
            if data.get('stop_reason') != 'end_turn':
                raise ValueError('Claude did not return a complete answer')
            raw = ''.join(p.get('text', '') for p in data.get('content', []) if p.get('type') == 'text')
    return parse_object(raw)
