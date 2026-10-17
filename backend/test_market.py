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

    def test_api_boundaries_and_overlap(self):
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        with TestClient(exchange.app) as client:
            self.assertEqual(client.get('/api/market').status_code, 200)
            self.assertEqual(client.post('/api/rounds', json={'mode': 'invalid'}).status_code, 422)
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
