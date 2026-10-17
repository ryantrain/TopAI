"""Provider / database / Devnet contracts, with no remote calls or wallet use."""
import asyncio
import copy
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from backend.test_market import exchange
from backend import evaluation, providers, receipts, storage
import httpx


class IntegrationCheck(unittest.TestCase):
    def test_gemini_http_contract_and_invalid_output(self):
        real_client = httpx.AsyncClient
        def respond(request):
            self.assertEqual(request.url.host, 'generativelanguage.googleapis.com')
            self.assertEqual(request.headers['x-goog-api-key'], 'test-key')
            self.assertNotIn('test-key', str(request.url))
            payload = json.loads(request.content)
            self.assertEqual(payload['generationConfig']['responseMimeType'], 'application/json')
            self.assertEqual(payload['contents'][0]['parts'][0]['text'], 'public history')
            return httpx.Response(200, json={'usageMetadata': {'totalTokenCount': 321}, 'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'thought': True, 'text': 'private thoughts'}, {'text': '{"orders": [], "reason": "Hold"}'}]}}]})
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            result = asyncio.run(providers.ask('public history', 'Trade', provider='gemini'))
            self.assertEqual(result['orders'], [])
            measured = asyncio.run(providers.ask('public history', 'Trade', provider='gemini', with_usage=True))
            self.assertEqual(measured['_total_tokens'], 321)
        for raw in ['[]', '{"bad": NaN}', 'not JSON']:
            with self.assertRaises(ValueError):
                providers.parse_object(raw)
        self.assertEqual(providers.parse_object('```json\n{"score": 3}\n```'), {'score': 3})

    def test_live_workers_route_without_ground_truth_and_traders_make_no_calls(self):
        async def check():
            state = exchange.initial_state()
            state.update(mode='live', round=1, configuration={
                'workers': [dict(provider=p, model=f'{p}-test') for p in ('openai', 'gemini', 'anthropic')],
                'evaluator': dict(provider='gemini', model='gemini-test')})
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
            # Traders are seeded now: a live round must not spend a single token on them.
            trader_mock = AsyncMock(return_value={'orders': [], 'reason': 'Waiting for a better entry.'})
            with patch.object(exchange, 'ask', trader_mock):
                await exchange.trading(state)
            trader_mock.assert_not_called()
            self.assertTrue(all(t['provider'] == 'simulated' for t in state['traders']))
            snapshots = [[{k: w.get(k) for k in ('id', 'price', 'scores')} for w in state['workers']]]
            self.assertTrue(all(s == snapshots[0] for s in snapshots))
            self.assertNotIn('answers', json.dumps(snapshots))
            self.assertNotIn('987654', json.dumps(snapshots))
            exchange.settle(state)
            before = copy.deepcopy(state['traders'])
            # The summary is a template now, so it makes no call and always produces text.
            with patch.object(exchange, 'ask', AsyncMock(side_effect=ValueError('unavailable'))) as unused:
                exchange.analyze(state)
            unused.assert_not_called()
            self.assertEqual(state['traders'], before)
            self.assertIn('led the round', state['analysis']['summary'])
            self.assertEqual(state['analysis']['provider'], 'simulated')
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
            self.assertEqual(sample['attempted'], evaluation.DEFAULT_BATCH)
            self.assertGreater(sample['total_tokens'], 0)
            self.assertGreater(sample['elapsed_seconds'], 0)
            self.assertEqual(sample['correct'], sum(answer['correct'] for answer in a['answers']))
        json.dumps(first, allow_nan=False)

    def test_readiness_and_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            config = providers.configuration()
            # Traders and the analyst have no provider any more; the evaluator is always Gemini.
            self.assertNotIn('trader', config)
            self.assertNotIn('analyst', config)
            self.assertEqual(config['evaluator'], dict(provider='gemini', model=providers.model_for('gemini')))
            self.assertEqual(providers.readiness(config), ['GEMINI_API_KEY', 'OPENAI_API_KEY'])
            os.environ['WORKER_PROVIDERS'] = 'openai,invalid,gemini'
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
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://test/market'}), patch.object(psycopg, 'connect', return_value=context) as connect:
            storage.save('unused', state)
        connect.assert_called_once_with('postgresql://test/market', connect_timeout=10)
        inserts = [c for c in db.execute.call_args_list if c.args[0].startswith('INSERT')]
        self.assertEqual(len(inserts), 2)
        self.assertIn('%s::jsonb', inserts[0].args[0])
        self.assertNotIn(state['session_id'], inserts[1].args[0])
        self.assertEqual(inserts[1].args[1][0], state['session_id'])

    def test_devnet_receipt_hash_and_confirmation(self):
        state = exchange.initial_state()
        state['round'] = 1
        for worker in state['workers']:
            worker['score'] = 80
        exchange.settle(state)
        prepared = receipts.prepare(state)
        same = copy.deepcopy(state)
        same['analysis'] = {'summary': 'This does not alter the market receipt.'}
        self.assertEqual(receipts.prepare(same)['digest'], prepared['digest'])
        same['traders'][0]['cash'] += 1
        self.assertNotEqual(receipts.prepare(same)['digest'], prepared['digest'])
        # Encode fixture data; verify accepts the compiled JSON RPC representation.
        value = int.from_bytes(prepared['memo'].encode(), 'big')
        encoded = ''
        while value:
            value, digit = divmod(value, 58)
            encoded = receipts.ALPHABET[digit] + encoded
        transaction = dict(meta={'err': None}, transaction={'message': {
            'accountKeys': ['test-wallet', receipts.MEMO_PROGRAM],
            'instructions': [{'programIdIndex': 1, 'data': encoded}]}})
        self.assertEqual(receipts.verify_transaction(transaction, prepared['memo']), 'test-wallet')
        with self.assertRaises(ValueError):
            receipts.verify_transaction(transaction, 'another round')
        transaction['meta']['err'] = {'failed': True}
        with self.assertRaises(ValueError):
            receipts.verify_transaction(transaction, prepared['memo'])


if __name__ == '__main__':
    unittest.main()
