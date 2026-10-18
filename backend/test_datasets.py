import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from backend.test_session import exchange
from backend import datasets
from fastapi.testclient import TestClient


class DatasetCheck(unittest.TestCase):
    def rows(self):
        return [dict(question=f'Classify item {i}', answer='niche-label') for i in range(40)]

    def test_formats_and_validation(self):
        rows = self.rows()
        for filename, raw in [('test.json', json.dumps(rows)), ('test.jsonl', '\n'.join(map(json.dumps, rows))),
                              ('test.csv', 'question,answer\n' + '\n'.join(f'{r["question"]},{r["answer"]}' for r in rows))]:
            self.assertEqual(datasets.parse_dataset(raw.encode(), filename, 'exact')['count'], 40)
        for rows in [self.rows()[:9], self.rows() + [self.rows()[0]], [dict(question='x', answer=None)] * 20]:
            with self.assertRaises(ValueError):
                datasets.parse_dataset(json.dumps(rows).encode(), 'test.json', 'exact')
        with self.assertRaises(ValueError):
            datasets.parse_dataset(json.dumps(self.rows()).encode(), 'test.json', 'numeric')
        self.assertTrue(datasets.matches(' niche-label ', 'niche-label', 'exact'))
        self.assertFalse(datasets.matches('Niche-label', 'niche-label', 'exact'))
        self.assertFalse(datasets.matches({'answer': 'niche-label'}, 'niche-label', 'exact'))
        self.assertTrue(datasets.matches('1.0000001', 1, 'numeric'))

    def test_custom_live_batches_no_answer_leak(self):
        state = exchange.initial_state()
        state.update(round=1, mode='live', dataset=datasets.parse_dataset(json.dumps(self.rows()).encode(), 'test.json', 'exact'))
        mock = AsyncMock(return_value=dict(answers=['niche-label'] * 10, _total_tokens=100))
        with patch.object(exchange, 'ask', mock):
            asyncio.run(exchange.benchmark(state))
            first_quiz = [a['question'] for a in state['workers'][0]['answers']]
            state['round'] = 2
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['score'] == 100 for w in state['workers']))
        self.assertTrue(set(first_quiz).isdisjoint(a['question'] for a in state['workers'][0]['answers']))
        self.assertTrue(all('niche-label' not in c.args[0] for c in mock.call_args_list))
        self.assertEqual(mock.call_args_list[0].args[0], mock.call_args_list[1].args[0])
        state['mode'] = 'demo'
        asyncio.run(exchange.benchmark(state))

    def test_api_lifecycle(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        with TestClient(exchange.app) as client:
            response = client.post('/api/dataset?filename=niche.json', content=json.dumps(self.rows()))
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('problems', response.json())
            self.assertNotIn('problems', client.get('/api/session').json()['dataset'])
            self.assertEqual(exchange.restore()['dataset']['count'], 40)
            self.assertEqual(client.post('/api/rounds', json=dict(rounds=5)).status_code, 400)
            exchange.session['round'] = 1
            self.assertEqual(client.delete('/api/dataset').status_code, 409)
            self.assertEqual(client.post('/api/dataset?filename=niche.json', content='[]').status_code, 409)
            client.post('/api/reset')
            self.assertIsNone(exchange.session['dataset'])

    def test_rubric_grading_and_cost(self):
        envelope = dict(instructions='Rubric: correctness 0–10. Calibration: example paper = 8.',
                        tolerance=1, examples=[dict(question=f'Paper {i}', answer=8) for i in range(20)])
        dataset = datasets.parse_dataset(json.dumps(envelope).encode(), 'papers.json', 'numeric')
        self.assertTrue(datasets.matches(7, 8, 'numeric', dataset['tolerance']))
        self.assertFalse(datasets.matches(6, 8, 'numeric', dataset['tolerance']))
        state = exchange.initial_state()
        state.update(round=1, mode='live', dataset=dataset)
        config = exchange.providers.configuration()
        config['cost_per_1k_tokens'] = [0.01, None, 0]
        state['configuration'] = config
        mock = AsyncMock(return_value=dict(answers=[7] * 10, _total_tokens=100))
        with patch.object(exchange, 'ask', mock):
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['score'] == 100 for w in state['workers']))
        self.assertIn(envelope['instructions'], mock.call_args_list[0].args[1])
        self.assertEqual(json.loads(mock.call_args_list[0].args[0]), [f'Paper {i}' for i in range(10)])
        self.assertEqual(state['workers'][0]['scores'][0]['estimated_cost_usd'], 0.001)
        self.assertIsNone(state['workers'][1]['scores'][0]['estimated_cost_usd'])
        self.assertEqual(state['workers'][2]['scores'][0]['estimated_cost_usd'], 0)
        for tolerance in [-1, True, '1', float('inf')]:
            envelope['tolerance'] = tolerance
            with self.assertRaises(ValueError):
                datasets.parse_dataset(json.dumps(envelope).encode(), 'papers.json', 'numeric')

    def test_cost_configuration_validation(self):
        import os
        for rates in ['1,2', '-1,2,3', 'nan,2,3', 'inf,2,3', 'x,2,3']:
            with patch.dict(os.environ, {'WORKER_COST_PER_1K_TOKENS': rates}):
                with self.assertRaises(ValueError):
                    exchange.providers.configuration()
        with patch.dict(os.environ, {'WORKER_COST_PER_1K_TOKENS': '0,,0.003'}):
            self.assertEqual(exchange.providers.configuration()['cost_per_1k_tokens'], [0, None, 0.003])
