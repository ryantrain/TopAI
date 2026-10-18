"""Run with: python -m unittest backend.test_market -v (no API calls)."""
import asyncio
import copy
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

scratch = tempfile.TemporaryDirectory()
os.environ['EXCHANGE_DB'] = str(Path(scratch.name) / 'test.sqlite3')
os.environ['DATABASE_URL'] = ''
from backend import main as exchange
from fastapi.testclient import TestClient


class MarketCheck(unittest.TestCase):
    def test_order_accounting_and_rejections(self):
        state = exchange.initial_state()
        trader = state['traders'][0]
        exchange.execute_order(state, trader, dict(worker='atlas', side='buy', quantity=10))
        self.assertEqual(trader['cash'], 9390)
        self.assertEqual(trader['holdings']['atlas'], 10)
        self.assertEqual(state['workers'][0]['price'], 62)
        exchange.execute_order(state, trader, dict(worker='atlas', side='sell', quantity=10))
        self.assertEqual(trader['cash'], 10000)
        for order in [dict(worker='atlas', side='sell', quantity=1),
                      dict(worker='atlas', side='buy', quantity=-2),
                      dict(worker='atlas', side='buy', quantity=True),
                      dict(worker='fake', side='buy', quantity=5)]:
            before = copy.deepcopy(state)
            with self.assertRaises(ValueError):
                exchange.execute_order(state, trader, order)
            self.assertEqual(before, state)
        trader['cash'] = 0
        with self.assertRaises(ValueError):
            exchange.execute_order(state, trader, dict(worker='atlas', side='buy', quantity=1))

    def test_complete_round_and_persistence(self):
        async def check():
            state = exchange.initial_state()
            state['round'] = 1
            await exchange.benchmark(state)
            self.assertTrue(all(len(w['answers']) == 10 for w in state['workers']))
            await exchange.trading(state)
            self.assertGreater(len(state['trades']), 0)
            spent = {t['name']: sum(o['total'] for o in state['trades'] if o['trader'] == t['name']) for t in state['traders']}
            held = {t['name']: dict(t['holdings']) for t in state['traders']}
            await exchange.benchmark(state, reveal=True)
            exchange.settle(state)
            for trader in state['traders']:
                redemption = sum(held[trader['name']].get(w['id'], 0) * (10 + w['score']) for w in state['workers'])
                self.assertAlmostEqual(trader['cash'], 10000 - spent[trader['name']] + redemption)
                self.assertEqual(trader['holdings'], {})
                self.assertAlmostEqual(trader['pnl'], trader['cash'] - 10000)
            exchange.persist(state)
            self.assertEqual(exchange.restore(), state)
        asyncio.run(check())

    def test_restore_replaces_legacy_duplicate_activity_ids(self):
        state = exchange.initial_state()
        state['activity'] = [
            dict(id=1792217648083416600, kind='benchmark', title='First', detail='', time='', round=1),
            dict(id=1792217648083416600, kind='benchmark', title='Second', detail='', time='', round=1),
        ]
        exchange.persist(state)
        ids = [item['id'] for item in exchange.restore()['activity']]
        self.assertTrue(all(isinstance(item, str) for item in ids))
        self.assertEqual(len(ids), len(set(ids)))

    def test_restore_clears_dataset_metadata_without_private_questions(self):
        state = exchange.initial_state()
        state.update(dataset=dict(name='stale', count=99), selection=['missing-file'])
        exchange.persist(state)
        restored = exchange.restore()
        self.assertIsNone(restored['dataset'])
        self.assertEqual(restored['selection'], [])

    def test_failed_round_rolls_back(self):
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        before = copy.deepcopy(exchange.market)
        async def fail(state, reveal=False):
            state['traders'][0]['cash'] = 1
            raise ValueError('test failure')
        async def no_wait(_):
            pass
        with patch.object(exchange, 'benchmark', fail), patch.object(exchange.asyncio, 'sleep', no_wait):
            asyncio.run(exchange.run_round())
        self.assertEqual(exchange.market['traders'], before['traders'])
        self.assertEqual(exchange.market['round'], 0)
        self.assertFalse(exchange.market['running'])
        self.assertEqual(exchange.market['phase'], 'error')

    def test_failed_round_names_http_provider_and_status(self):
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        async def fail(state, reveal=False):
            response = exchange.httpx.Response(429, request=exchange.httpx.Request('POST', 'https://generativelanguage.googleapis.com/v1beta/models/test'))
            raise exchange.httpx.HTTPStatusError('quota', request=response.request, response=response)
        with patch.object(exchange, 'benchmark', fail):
            asyncio.run(exchange.run_round())
        self.assertIn('Gemini HTTP 429', exchange.market['error'])

    def test_multiple_rounds_stop_after_a_failure(self):
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        calls = 0
        running_states = []

        async def fail_on_second_round():
            nonlocal calls
            calls += 1
            running_states.append(exchange.market['running'])
            exchange.market.update(running=False, phase='error' if calls == 2 else 'complete')

        with patch.object(exchange, 'run_round', fail_on_second_round):
            asyncio.run(exchange.run_rounds(3))
        self.assertEqual(calls, 2)
        self.assertEqual(running_states, [True, True])

    def test_selected_round_count_in_both_modes(self):
        async def no_wait(_):
            pass

        async def check(mode, count):
            exchange.market.clear()
            exchange.market.update(exchange.initial_state())
            response = await exchange.start_round(exchange.StartRequest(mode=mode, rounds=count))
            self.assertEqual(response['rounds'], count)
            await exchange.task
            self.assertEqual(exchange.market['round'], count)
            self.assertEqual(len(exchange.market['settlements']), count)
            self.assertEqual(exchange.market['phase'], 'complete')
            self.assertFalse(exchange.market['running'])

        # Keep the real round loop and settlement; replace external AI operations.
        async def benchmark(state, reveal=False):
            for worker in state['workers']:
                worker['score'] = 80

        async def no_operation(state):
            pass

        with patch.object(exchange.asyncio, 'sleep', no_wait), \
             patch.object(exchange.providers, 'readiness', return_value=[]), \
             patch.object(exchange, 'benchmark', benchmark), \
             patch.object(exchange, 'trading', no_operation), \
             patch.object(exchange, 'analyze', no_operation):
            for mode in ('demo', 'live'):
                for count in (1, 3, 10):
                    with self.subTest(mode=mode, rounds=count):
                        asyncio.run(check(mode, count))

    def test_demo_run_only_uses_selected_agents(self):
        async def check():
            exchange.market.clear()
            exchange.market.update(exchange.initial_state())
            response = await exchange.start_round(exchange.StartRequest(mode='demo', agent_ids=['nova']))
            self.assertEqual(response['status'], 'started')
            self.assertEqual([worker['id'] for worker in exchange.market['workers']], ['nova'])
            exchange.task.cancel()
            try:
                await exchange.task
            except asyncio.CancelledError:
                pass
            exchange.market['running'] = False
        asyncio.run(check())

    def test_api_boundaries_and_overlap(self):
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        self.assertEqual(exchange.StartRequest(rounds=3).rounds, 3)
        with TestClient(exchange.app) as client:
            self.assertEqual(client.get('/api/market').status_code, 200)
            self.assertEqual(client.post('/api/rounds', json={'mode': 'invalid'}).status_code, 422)
            self.assertEqual(client.post('/api/rounds', json={'mode': 'demo', 'rounds': 11}).status_code, 422)
            exchange.market['running'] = True
            self.assertEqual(client.post('/api/rounds', json={'mode': 'demo'}).status_code, 409)
            self.assertEqual(client.post('/api/reset').status_code, 409)
            exchange.market['running'] = False
            with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
                self.assertEqual(client.post('/api/rounds', json={'mode': 'live'}).status_code, 400)
            self.assertEqual(client.post('/api/reset').status_code, 200)

    def test_scoring_parser(self):
        self.assertEqual(exchange.number('reasoning\n#### 1,200'), 1200)
        self.assertEqual(exchange.number('$10.50'), 10.5)
        for invalid in ['NaN', 'Infinity', '4 or 5', None]:
            with self.assertRaises(ValueError):
                exchange.number(invalid)


if __name__ == '__main__':
    unittest.main()
