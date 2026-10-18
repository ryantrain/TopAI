"""Provider and database contracts, with no remote calls."""
import asyncio
import copy
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from backend.test_session import exchange
from backend import providers, storage
import httpx


class IntegrationCheck(unittest.TestCase):
    def test_openai_json_contract(self):
        client = MagicMock()
        client.responses.create = AsyncMock(return_value=SimpleNamespace(output_text='{"status":"ready"}', usage=None))
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=None)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-key'}), \
                patch('openai.AsyncOpenAI', return_value=context):
            result = asyncio.run(providers.ask('question batch', 'Answer', provider='openai'))
        self.assertEqual(result, {'status': 'ready'})
        request = client.responses.create.await_args.kwargs
        self.assertEqual(request['input'], 'JSON input:\nquestion batch')
        self.assertEqual(request['text'], {'format': {'type': 'json_object'}})

    def test_browser_agent_configuration_keeps_keys_private(self):
        client = MagicMock()
        client.responses.create = AsyncMock(return_value=SimpleNamespace(output_text='{"status":"ready"}', usage=None))
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=None)
        first_key = 'runtime-key-one'
        second_key = 'runtime-key-two'
        try:
            with patch.dict(os.environ, {}, clear=True):
                config = providers.configure_agents([
                    {'provider': 'openai', 'model': 'first-model', 'label': 'Ada', 'api_key': first_key},
                    {'provider': 'openai', 'model': 'second-model', 'label': 'Grace', 'api_key': second_key},
                ])
                self.assertEqual(providers.readiness(config), [])
                public = providers.public_configuration(config)
                self.assertNotIn(first_key, repr(config) + repr(public))
                self.assertNotIn(second_key, repr(config) + repr(public))
                self.assertNotIn('credential_id', repr(public))
                reused = providers.configure_agents([
                    {'provider': 'openai', 'model': 'first-model-v2', 'label': 'Ada', 'api_key': ''},
                    {'provider': 'openai', 'model': 'second-model-v2', 'label': 'Grace', 'api_key': ''},
                ])
                self.assertEqual(providers.readiness(reused), [])
                self.assertEqual(providers.public_configuration(reused)['workers'][1]['label'], 'Grace')
                credential_id = reused['workers'][1]['credential_id']
                with patch('openai.AsyncOpenAI', return_value=context) as constructor:
                    result = asyncio.run(providers.ask('question batch', 'Answer', provider='openai', credential_id=credential_id))
                self.assertEqual(result, {'status': 'ready'})
                constructor.assert_called_once_with(api_key=second_key, timeout=75, max_retries=1)
        finally:
            providers.clear_agent_configuration()

    def test_gemini_http_contract_and_invalid_output(self):
        real_client = httpx.AsyncClient
        def respond(request):
            self.assertEqual(request.url.host, 'generativelanguage.googleapis.com')
            self.assertEqual(request.headers['x-goog-api-key'], 'test-key')
            self.assertNotIn('test-key', str(request.url))
            payload = json.loads(request.content)
            self.assertEqual(payload['generationConfig']['responseMimeType'], 'application/json')
            self.assertEqual(payload['contents'][0]['parts'][0]['text'], 'question batch')
            return httpx.Response(200, json={'usageMetadata': {'totalTokenCount': 321}, 'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'thought': True, 'text': 'private thoughts'}, {'text': '{"answers": [], "reason": "Ready"}'}]}}]})
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            result = asyncio.run(providers.ask('question batch', 'Answer', provider='gemini'))
            self.assertEqual(result['answers'], [])
            measured = asyncio.run(providers.ask('question batch', 'Answer', provider='gemini', with_usage=True))
            self.assertEqual(measured['_total_tokens'], 321)
        for raw in ['[]', '{"bad": NaN}', 'not JSON']:
            with self.assertRaises(ValueError):
                providers.parse_object(raw)
        self.assertEqual(providers.parse_object('```json\n{"score": 3}\n```'), {'score': 3})
        self.assertEqual(providers.parse_object('Here is the result:\n```json\n{"score": 4}\n```'), {'score': 4})
        with self.assertRaisesRegex(providers.ProviderResponseError, 'OpenAI model test-model returned invalid JSON') as caught:
            providers.parse_provider_object('not JSON secret-response', 'openai', 'test-model')
        self.assertNotIn('secret-response', str(caught.exception))

    def test_anthropic_uses_structured_output_schema(self):
        real_client = httpx.AsyncClient
        schema = {'type': 'object', 'properties': {'answers': {'type': 'array', 'items': {'type': 'string'}}},
                  'required': ['answers'], 'additionalProperties': False}

        def respond(request):
            self.assertEqual(request.url.host, 'api.anthropic.com')
            payload = json.loads(request.content)
            self.assertEqual(payload['output_config']['format'], {'type': 'json_schema', 'schema': schema})
            return httpx.Response(200, json={'stop_reason': 'end_turn', 'usage': {'input_tokens': 10, 'output_tokens': 5},
                'content': [{'type': 'text', 'text': '{"answers":["ready"]}'}]})

        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}), \
                patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            result = asyncio.run(providers.ask('question batch', 'Answer', provider='anthropic', model='claude-sonnet-4-6', schema=schema, with_usage=True))
        self.assertEqual(result['answers'], ['ready'])
        self.assertEqual(result['_total_tokens'], 15)

    def test_live_workers_route_without_ground_truth(self):
        async def check():
            state = exchange.initial_state()
            state.update(mode='live', round=1, configuration={
                'workers': [dict(provider=p, model=f'{p}-test') for p in ('openai', 'gemini', 'anthropic')]})
            problems = [dict(question=f'Question {i}?', answer=987654) for i in range(10)]
            worker_mock = AsyncMock(return_value={'answers': [987654] * 10, '_total_tokens': 500})
            with patch.object(exchange, 'gsm8k_problems', return_value=problems), patch.object(exchange, 'ask', worker_mock):
                await exchange.benchmark(state)
            self.assertEqual([c.kwargs['provider'] for c in worker_mock.call_args_list], ['openai', 'gemini', 'anthropic'])
            self.assertTrue(all('987654' not in c.args[0] for c in worker_mock.call_args_list))
            self.assertTrue(all(w['score'] == 100 for w in state['workers']))
            self.assertTrue(all(w['scores'][0]['total_tokens'] == 500 for w in state['workers']))
            self.assertTrue(all(w['scores'][0]['elapsed_seconds'] > 0 for w in state['workers']))
            self.assertTrue(all(w['scores'][0]['correct'] == 10 for w in state['workers']))
        asyncio.run(check())

    def test_demo_measurements_are_seeded_and_archivable(self):
        first = exchange.initial_state()
        first['round'] = 1
        second = copy.deepcopy(first)
        asyncio.run(exchange.benchmark(first))
        asyncio.run(exchange.benchmark(second))
        for a, b in zip(first['workers'], second['workers']):
            sample = a['scores'][0]
            self.assertEqual(sample, b['scores'][0])
            self.assertEqual(sample['attempted'], 10)
            self.assertGreater(sample['total_tokens'], 0)
            self.assertGreater(sample['elapsed_seconds'], 0)
            self.assertEqual(sample['correct'], sum(answer['correct'] for answer in a['answers']))
        json.dumps(first, allow_nan=False)

    def test_readiness_and_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            config = providers.configuration()
            # The default roster is one OpenAI and one Anthropic agent, both on a cheap model.
            self.assertEqual([w['provider'] for w in config['workers']], ['openai', 'anthropic'])
            self.assertEqual([w['model'] for w in config['workers']], ['gpt-4o-mini', 'claude-haiku-5-5'])
            self.assertEqual(providers.readiness(config), ['agent 1 OPENAI_API_KEY', 'agent 2 ANTHROPIC_API_KEY'])
            os.environ['WORKER_PROVIDERS'] = 'openai,invalid,gemini'
            with self.assertRaises(ValueError):
                providers.configuration()
        six = 'openai,gemini,anthropic,openai,gemini,ollama'
        with patch.dict(os.environ, {'WORKER_PROVIDERS': six, 'WORKER_COST_PER_1K_TOKENS': ',,,,,'}):
            self.assertEqual(len(providers.configuration()['workers']), 6)
        for invalid in ('', 'openai,gemini,anthropic,openai,gemini,ollama,openai'):
            with patch.dict(os.environ, {'WORKER_PROVIDERS': invalid, 'WORKER_COST_PER_1K_TOKENS': ''}):
                with self.assertRaises(ValueError):
                    providers.configuration()

    def test_sqlite_archive_survives_reset_and_legacy_load(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'DATABASE_URL': ''}):
            path = Path(folder) / 'archive.sqlite3'
            state = exchange.initial_state()
            state.update(round=1, phase='complete')
            storage.save(path, state)
            storage.save(path, state)
            self.assertEqual(len(storage.history(path)), 1)
            storage.save(path, exchange.initial_state())
            self.assertEqual(len(storage.history(path)), 1)
            self.assertEqual(storage.history(path)[0]['session_id'], state['session_id'])
            legacy = Path(folder) / 'legacy.sqlite3'
            db = sqlite3.connect(legacy)
            try:
                db.execute('CREATE TABLE market(id INTEGER PRIMARY KEY, state TEXT)')
                db.execute('INSERT INTO market VALUES(1, ?)', (json.dumps(state),))
                db.commit()
            finally:
                db.close()
            self.assertEqual(storage.load(legacy)['session_id'], state['session_id'])

    def test_postgres_parameterized_snapshot_and_archive(self):
        import psycopg
        db = MagicMock()
        context = MagicMock()
        context.__enter__.return_value = db
        state = exchange.initial_state()
        state.update(round=1, phase='complete')
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://test/session'}), patch.object(psycopg, 'connect', return_value=context) as connect:
            storage.save('unused', state)
        connect.assert_called_once_with('postgresql://test/session', connect_timeout=10)
        inserts = [c for c in db.execute.call_args_list if c.args[0].startswith('INSERT')]
        self.assertEqual(len(inserts), 2)
        self.assertIn('%s::jsonb', inserts[0].args[0])
        self.assertNotIn(state['session_id'], inserts[1].args[0])
        self.assertEqual(inserts[1].args[1][0], state['session_id'])

if __name__ == '__main__':
    unittest.main()
