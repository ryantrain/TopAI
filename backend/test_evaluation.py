"""Local inference contracts and dynamic grading; no remote calls or model downloads."""
import asyncio
import copy
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from backend.test_market import exchange
from backend import datasets, evaluation, providers


class EvaluationCheck(unittest.TestCase):
    def test_generated_items_count_and_saved_metadata(self):
        plan = evaluation.BenchmarkPlan(goal='Generate ideas', method='items', output_unit='ideas').model_dump()
        answers = [['Solar oven', ' solar   OVEN ', 'Rain barrel'], 'not json', [], [True], '["One", "Two"]']
        grades = asyncio.run(evaluation.grade([dict(answer='reference')] * len(answers), answers, plan))
        self.assertEqual([g['output_count'] for g in grades], [2, 0, 0, 0, 2])
        self.assertEqual([g['correct'] for g in grades], [True, False, False, False, True])
        with TestClient(exchange.app) as client:
            saved = client.put('/api/benchmark', json=plan)
            self.assertEqual(saved.status_code, 200)
            self.assertIn('saved_at', saved.json())
            self.assertEqual(client.get('/api/market').json()['dataset']['benchmark_plan'], saved.json())
            self.assertEqual(exchange.restore()['dataset']['benchmark_plan'], saved.json())
        state = exchange.initial_state()
        state.update(round=1, mode='live', dataset=exchange.market['dataset'])
        with patch.object(exchange, 'ask', AsyncMock(return_value=dict(answers=[['A', 'a', 'B']] * 10, _total_tokens=1000))) as ask:
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['scores'][0]['output_count'] == 20 for w in state['workers']))
        self.assertIn('JSON array of distinct', ask.call_args.args[1])
        self.assertEqual(asyncio.run(evaluation.suggest('Brainstorm ideas'))['method'], 'items')

    def setUp(self):
        self.previous = copy.deepcopy(exchange.market)
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())
        exchange.market['dataset'] = datasets.parse_dataset(json.dumps([
            dict(question=f'Input {i}', answer='reference') for i in range(20)
        ]).encode(), 'examples.json', 'exact')

    def tearDown(self):
        exchange.market.clear()
        exchange.market.update(self.previous)

    def test_local_rules_and_json_types(self):
        async def check():
            plan = evaluation.BenchmarkPlan(goal='Extract fields', method='json').model_dump()
            problems = [dict(question='extract', answer='{"a":1,"b":[true,2]}')]
            self.assertTrue((await evaluation.grade(problems, [{'b': [True, 2], 'a': 1}], plan))[0]['correct'])
            self.assertFalse((await evaluation.grade(problems, [{'b': [1, 2], 'a': 1}], plan))[0]['correct'])
            self.assertFalse((await evaluation.grade(problems, ['invalid'], plan))[0]['correct'])
            self.assertFalse((await evaluation.grade(problems, ['{"a":NaN}'], plan))[0]['correct'])
            plan.update(method='numeric', tolerance=1)
            self.assertTrue((await evaluation.grade([dict(answer='10')], [9], plan))[0]['correct'])
            self.assertFalse((await evaluation.grade([dict(answer='10')], [8], plan))[0]['correct'])
        asyncio.run(check())
        with self.assertRaises(ValueError):
            evaluation.strict_json('{"a":1e999}')

    def test_judge_threshold_validation_and_identity_blinding(self):
        plan = evaluation.BenchmarkPlan(goal='Summarize faithfully', method='rubric', rubric='No invented details', pass_score=85).model_dump()
        plan['judge_model'] = 'local-judge'
        mock = AsyncMock(return_value=dict(grades=[dict(id=0, score=84, reason='Missing key action')]))
        with patch.object(providers, 'ask', mock):
            grade = asyncio.run(evaluation.grade([dict(question='Ticket', answer='Expected action')], ['Summary'], plan))[0]
        self.assertFalse(grade['correct'])
        self.assertEqual(grade['evaluation_score'], 84)
        self.assertEqual(mock.call_args.kwargs, dict(provider='ollama', model='local-judge'))
        self.assertNotIn('provider', mock.call_args.args[0])
        for grades in [[], [dict(id=1, score=90, reason='x')], [dict(id=0, score=True, reason='x')], [dict(id=0, score=101, reason='x')]]:
            with patch.object(providers, 'ask', AsyncMock(return_value=dict(grades=grades))):
                with self.assertRaises(ValueError):
                    asyncio.run(evaluation.grade([dict(question='Q', answer='A')], ['B'], plan))

    def test_plan_api_validation_freeze_and_persistence(self):
        with TestClient(exchange.app) as client:
            body = dict(goal='Classify tickets', method='exact', instructions='Return a label')
            self.assertEqual(client.put('/api/benchmark', json=body).status_code, 200)
            self.assertEqual(exchange.restore()['dataset']['benchmark_plan']['goal'], body['goal'])
            self.assertEqual(client.put('/api/benchmark', json={**body, 'method': 'numeric'}).status_code, 400)
            self.assertEqual(client.put('/api/benchmark', json={**body, 'method': 'json'}).status_code, 400)
            self.assertEqual(client.put('/api/benchmark', json={**body, 'method': 'rubric'}).status_code, 422)
            exchange.market['round'] = 1
            self.assertEqual(client.put('/api/benchmark', json=body).status_code, 409)
            exchange.market['round'] = 0
            client.delete('/api/dataset')
            self.assertEqual(client.put('/api/benchmark', json=body).status_code, 400)

    def test_suggestion_is_draft_and_local_failure_actionable(self):
        with TestClient(exchange.app) as client:
            draft = dict(goal='Classify tickets', method='exact')
            with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(evaluation, 'suggest', AsyncMock(return_value=draft)):
                self.assertEqual(client.post('/api/benchmark/suggest', json=dict(goal=draft['goal'])).status_code, 200)
            self.assertNotIn('benchmark_plan', exchange.market['dataset'])
            with patch.object(providers, 'local_models_ready', AsyncMock(side_effect=ConnectionError())):
                response = client.post('/api/benchmark/suggest', json=dict(goal=draft['goal']))
                self.assertEqual(response.status_code, 400)
                self.assertIn('manually', response.json()['detail'])

    def test_ollama_http_contract_and_preflight(self):
        real_client = httpx.AsyncClient
        def respond(request):
            self.assertEqual(request.url.host, '127.0.0.1')
            self.assertEqual(request.url.port, 11434)
            if request.method == 'GET':
                return httpx.Response(200, json=dict(models=[dict(name='local-test:latest')]))
            body = json.loads(request.content)
            self.assertFalse(body['stream'])
            self.assertEqual(body['format'], 'json')
            self.assertEqual(body['options']['temperature'], 0)
            self.assertNotIn('Authorization', request.headers)
            return httpx.Response(200, json=dict(done=True, done_reason='stop', message=dict(content='{"answers":["x"]}'), prompt_eval_count=20, eval_count=5))
        with patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            result = asyncio.run(providers.ask('question', 'instruction', provider='ollama', model='local-test', with_usage=True))
            self.assertEqual(result['_total_tokens'], 25)
            asyncio.run(providers.local_models_ready(['local-test']))
            with self.assertRaises(ValueError):
                asyncio.run(providers.local_models_ready(['missing']))
        with patch.dict(os.environ, dict(WORKER_PROVIDERS='ollama,ollama,ollama', TRADER_PROVIDER='ollama', ANALYST_PROVIDER='ollama')):
            self.assertEqual(providers.readiness(providers.configuration()), [])
        with self.assertRaises(ValueError):
            asyncio.run(providers.ask('x', 'y', provider='ollama', model='model:cloud'))

    def test_numeric_plan_over_text_import_and_ground_truth_separation(self):
        dataset = exchange.market['dataset']
        for p in dataset['problems']:
            p['answer'] = '10'
        plan = evaluation.BenchmarkPlan(goal='Estimate marks', method='numeric', tolerance=1).model_dump()
        dataset['benchmark_plan'] = plan
        state = exchange.market
        state.update(round=1, mode='live')
        mock = AsyncMock(return_value=dict(answers=[9] * 10, _total_tokens=100))
        with patch.object(exchange, 'ask', mock):
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['score'] == 100 for w in state['workers']))
        self.assertIn(plan['goal'], mock.call_args.args[1])
        self.assertNotIn('answer', mock.call_args.args[0])
        state['mode'] = 'demo'
        asyncio.run(exchange.benchmark(state))

    def test_missing_local_model_prevents_paid_worker_calls(self):
        plan = evaluation.BenchmarkPlan(goal='Summarize', method='rubric', rubric='Preserve facts').model_dump()
        plan['judge_model'] = 'local-judge'
        exchange.market['dataset']['benchmark_plan'] = plan
        with TestClient(exchange.app) as client, patch.object(providers, 'readiness', return_value=[]), patch.object(providers, 'local_models_ready', AsyncMock(side_effect=ConnectionError())), patch.object(exchange, 'ask', AsyncMock()) as ask:
            self.assertEqual(client.post('/api/rounds', json=dict(mode='live')).status_code, 400)
            self.assertFalse(exchange.market['running'])
            ask.assert_not_called()

    def test_live_rubric_run_keeps_judge_usage_out_of_worker_metrics(self):
        state = exchange.market
        state.update(mode='live', round=1)
        plan = evaluation.BenchmarkPlan(goal='Summarize faithfully', method='rubric', rubric='No invented facts', pass_score=80).model_dump()
        plan['judge_model'] = 'judge-test'
        state['dataset']['benchmark_plan'] = plan
        worker = AsyncMock(return_value=dict(answers=['summary'] * 10, _total_tokens=100))
        judge = AsyncMock(return_value=dict(grades=[dict(id=i, score=90 if i < 8 else 60, reason='Evidence checked') for i in range(10)]))
        with patch.object(exchange, 'ask', worker), patch.object(providers, 'ask', judge):
            asyncio.run(exchange.benchmark(state))
        self.assertEqual(judge.call_count, 3)
        self.assertTrue(all(w['score'] == 80 for w in state['workers']))
        self.assertTrue(all(w['scores'][0]['total_tokens'] == 100 for w in state['workers']))
        self.assertTrue(all(w['answers'][0]['evaluation_score'] == 90 for w in state['workers']))
        self.assertTrue(all('reference' not in c.args[0] for c in worker.call_args_list))
        self.assertTrue(all('rubric' not in c.args[1] for c in worker.call_args_list))

    def test_plain_language_paper_grading_is_local_and_tests_actual_grading(self):
        goal = 'i want the best one for grading papers'
        dataset = exchange.market['dataset']
        for p in dataset['problems']:
            p['answer'] = 8
        dataset['tolerance'] = 1
        with patch.object(providers, 'ask', AsyncMock()) as ask, patch.object(providers, 'local_models_ready', AsyncMock()) as ready:
            plan = asyncio.run(evaluation.suggest(goal, dataset))
        ask.assert_not_called()
        ready.assert_not_called()
        self.assertEqual(plan['goal'], goal)
        self.assertEqual(plan['method'], 'numeric')
        self.assertEqual(plan['tolerance'], 1)
        self.assertIn('Grade each supplied paper', plan['instructions'])
        self.assertIsNone(evaluation.paper_grading_plan('Find a model for classifying support tickets'))
        self.assertEqual(evaluation.paper_grading_plan('Grade essays and give feedback', dataset)['method'], 'rubric')
        for p in dataset['problems']:
            p['answer'] = 'Human feedback and grade'
        self.assertEqual(evaluation.paper_grading_plan(goal, dataset)['method'], 'rubric')

    def test_task_entry_before_upload_and_dataset_specific_draft(self):
        with TestClient(exchange.app) as client:
            exchange.market['dataset'] = None
            response = client.post('/api/benchmark/suggest', json=dict(goal='I want the best model for grading papers'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['method'], 'numeric')
            self.assertIsNone(exchange.market['dataset'])

    def test_general_planner_uses_dataset_context_without_reference_keys(self):
        dataset = exchange.market['dataset']
        response = dict(goal='ignored', method='exact', instructions='Classify each input')
        mock = AsyncMock(return_value=response)
        with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', mock):
            result = asyncio.run(evaluation.suggest('Classify tickets', dataset))
        sent = json.loads(mock.call_args.args[0])
        self.assertEqual(sent['dataset']['count'], 20)
        self.assertEqual(sent['dataset']['question_samples'][0], dataset['problems'][0]['question'])
        self.assertNotIn('\"answer\":', mock.call_args.args[0])
        self.assertEqual(result['goal'], 'Classify tickets')
