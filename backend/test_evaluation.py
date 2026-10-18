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
        plan = evaluation.BenchmarkPlan(goal='Generate ideas', method='items', output_unit='ideas', batch_size=10).model_dump()
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

    def test_evaluator_decides_verdicts_and_receives_criteria(self):
        plan = evaluation.BenchmarkPlan(goal='Estimate marks', method='numeric', tolerance=1,
                                        instructions='Return the mark', rubric='Reject invented marks').model_dump()
        verdicts = dict(grades=[dict(id=0, correct=True, score=95, reason='Within tolerance'),
                                dict(id=1, correct=False, score=10, reason='Contradicts the reference')])
        mock = AsyncMock(return_value=verdicts)
        with patch.object(providers, 'ask', mock):
            grades = asyncio.run(evaluation.grade(
                [dict(question='Paper 1', answer='10'), dict(question='Paper 2', answer='10')], [9, 2], plan))
        self.assertEqual([g['correct'] for g in grades], [True, False])
        self.assertEqual(grades[0]['evaluation_score'], 95)
        self.assertEqual(grades[1]['evaluation_reason'], 'Contradicts the reference')
        # The verdict is the evaluator's, so no local rule may override it.
        self.assertEqual(mock.call_args.kwargs['provider'], 'gemini')
        self.assertEqual(mock.call_args.kwargs['model'], providers.model_for('gemini'))
        self.assertEqual(mock.call_args.kwargs['schema']['properties']['grades']['maxItems'], 2)
        criteria = mock.call_args.args[1]
        self.assertIn('Return the mark', criteria)
        self.assertIn('Reject invented marks', criteria)
        self.assertIn('numeric_tolerance', criteria)
        sent = json.loads(mock.call_args.args[0])
        self.assertEqual([item['reference'] for item in sent], ['10', '10'])
        with self.assertRaises(ValueError):
            evaluation.strict_json('{"a":1e999}')

    def test_evaluator_contract_and_identity_blinding(self):
        plan = evaluation.BenchmarkPlan(goal='Summarize faithfully', method='rubric', rubric='No invented details', batch_size=10).model_dump()
        mock = AsyncMock(return_value=dict(grades=[dict(id=0, correct=False, score=84, reason='Missing key action')]))
        with patch.object(providers, 'ask', mock):
            grade = asyncio.run(evaluation.grade([dict(question='Ticket', answer='Expected action')], ['Summary'], plan))[0]
        self.assertFalse(grade['correct'])
        self.assertEqual(grade['evaluation_score'], 84)
        self.assertNotIn('provider', mock.call_args.args[0])
        # A malformed or missing verdict must fail the round, never default to correct.
        for grades in [[], [dict(id=1, correct=True, score=90, reason='x')],
                       [dict(id=0, score=90, reason='x')],
                       [dict(id=0, correct='yes', score=90, reason='x')],
                       [dict(id=0, correct=True, score=True, reason='x')],
                       [dict(id=0, correct=True, score=101, reason='x')],
                       [dict(id=0, correct=True, score=90, reason='  ')]]:
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
            saved = client.put('/api/benchmark', json={**body, 'method': 'rubric'})
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()['evaluator'], dict(provider='gemini', model=providers.model_for('gemini')))
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
        expected_format = 'json'
        expected_tokens = 8192
        def respond(request):
            self.assertEqual(request.url.host, '127.0.0.1')
            self.assertEqual(request.url.port, 11434)
            if request.method == 'GET':
                return httpx.Response(200, json=dict(models=[dict(name='local-test:latest')]))
            body = json.loads(request.content)
            self.assertFalse(body['stream'])
            self.assertIs(body['think'], False)
            self.assertEqual(body['format'], expected_format)
            self.assertEqual(body['options']['temperature'], 0)
            self.assertEqual(body['options']['num_predict'], expected_tokens)
            self.assertEqual(body['keep_alive'], '15m')
            self.assertNotIn('Authorization', request.headers)
            return httpx.Response(200, json=dict(done=True, done_reason='stop', message=dict(content='{"answers":["x"]}'), prompt_eval_count=20, eval_count=5))
        with patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            result = asyncio.run(providers.ask('question', 'instruction', provider='ollama', model='local-test', with_usage=True))
            self.assertEqual(result['_total_tokens'], 25)
            expected_format = evaluation.BenchmarkProtocol.model_json_schema()
            expected_tokens = 2048
            asyncio.run(providers.ask('question', 'instruction', provider='ollama', model='local-test', schema=expected_format, max_tokens=2048, timeout=60))
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
        plan = evaluation.BenchmarkPlan(goal='Estimate marks', method='numeric', tolerance=1, batch_size=10).model_dump()
        dataset['benchmark_plan'] = plan
        state = exchange.market
        state.update(round=1, mode='live')
        mock = AsyncMock(return_value=dict(answers=[9] * 10, _total_tokens=100))
        gemini = AsyncMock(return_value=dict(grades=[dict(id=i, correct=True, score=99, reason='Within tolerance') for i in range(10)]))
        with patch.object(exchange, 'ask', mock), patch.object(providers, 'ask', gemini):
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['score'] == 100 for w in state['workers']))
        self.assertNotIn(plan['goal'], mock.call_args.args[1])
        self.assertNotIn('answer', mock.call_args.args[0])
        # Demo results are entirely simulated and never wait for a real evaluator.
        state['mode'] = 'demo'
        graded_in_live = gemini.call_count
        with patch.object(providers, 'ask', gemini):
            asyncio.run(exchange.benchmark(state))
        self.assertEqual(gemini.call_count, graded_in_live)
        self.assertTrue(all(w['provider'] == 'simulated' for w in state['workers']))

    def test_missing_local_model_prevents_paid_worker_calls(self):
        plan = evaluation.BenchmarkPlan(goal='Summarize', method='rubric', rubric='Preserve facts', batch_size=10).model_dump()
        exchange.market['dataset']['benchmark_plan'] = plan
        with TestClient(exchange.app) as client, patch.dict(os.environ, dict(WORKER_PROVIDERS='ollama,ollama,ollama', GEMINI_API_KEY='test-key')), \
                patch.object(providers, 'readiness', return_value=[]), \
                patch.object(providers, 'local_models_ready', AsyncMock(side_effect=ConnectionError())), \
                patch.object(exchange, 'ask', AsyncMock()) as ask:
            self.assertEqual(client.post('/api/rounds', json=dict(mode='live')).status_code, 400)
            self.assertFalse(exchange.market['running'])
            ask.assert_not_called()

    def test_live_run_without_gemini_checks_local_fallback(self):
        exchange.market['dataset']['benchmark_plan'] = evaluation.BenchmarkPlan(goal='Classify', method='exact', batch_size=10).model_dump()
        # Missing Gemini uses Ollama; fail before workers if it is unavailable.
        with TestClient(exchange.app) as client, patch.dict(os.environ, {'GEMINI_API_KEY': ''}), \
                patch.object(exchange, 'ask', AsyncMock()) as ask, \
                patch.object(providers, 'local_models_ready', AsyncMock(side_effect=ValueError('Download local fallback first'))):
            response = client.post('/api/rounds', json=dict(mode='live'))
            self.assertEqual(response.status_code, 400)
            self.assertIn('local fallback', response.json()['detail'])
            ask.assert_not_called()

    def test_live_run_keeps_evaluator_usage_out_of_worker_metrics(self):
        state = exchange.market
        state.update(mode='live', round=1)
        plan = evaluation.BenchmarkPlan(goal='Summarize faithfully', method='rubric', rubric='No invented facts', batch_size=10).model_dump()
        state['dataset']['benchmark_plan'] = plan
        worker = AsyncMock(return_value=dict(answers=['summary'] * 10, _total_tokens=100))
        gemini = AsyncMock(return_value=dict(grades=[dict(id=i, correct=i < 8, score=90 if i < 8 else 60, reason='Evidence checked') for i in range(10)]))
        with patch.object(exchange, 'ask', worker), patch.object(providers, 'ask', gemini):
            asyncio.run(exchange.benchmark(state))
        self.assertEqual(gemini.call_count, 3)
        self.assertTrue(all(w['score'] == 80 for w in state['workers']))
        self.assertTrue(all(w['scores'][0]['total_tokens'] == 100 for w in state['workers']))
        self.assertTrue(all(w['answers'][0]['evaluation_score'] == 90 for w in state['workers']))
        self.assertTrue(all('reference' not in c.args[0] for c in worker.call_args_list))
        self.assertTrue(all('No invented facts' not in c.args[1] for c in worker.call_args_list))

    def test_paper_grading_template_is_refined_by_planner(self):
        goal = 'i want the best one for grading papers'
        dataset = exchange.market['dataset']
        for p in dataset['problems']:
            p['answer'] = 8
        dataset['tolerance'] = 1
        template = evaluation.paper_grading_plan(goal, dataset)
        protocol = json.loads(template['execution_spec'])
        with patch.object(providers, 'ask', AsyncMock(return_value=protocol)) as ask, patch.object(providers, 'local_models_ready', AsyncMock()) as ready:
            plan = asyncio.run(evaluation.suggest(goal, dataset))
        ask.assert_awaited_once()
        ready.assert_awaited_once()
        schema = ask.call_args.kwargs['schema']
        self.assertEqual(schema['required'], list(evaluation.BenchmarkProtocol.model_fields))
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(json.loads(ask.call_args.args[0])['paper_grading_template']['repetitions'], 3)
        self.assertNotIn('execution_spec', json.loads(ask.call_args.args[0])['paper_grading_template'])
        self.assertEqual(ask.call_args.kwargs['max_tokens'], 2048)
        self.assertEqual(ask.call_args.kwargs['timeout'], 60)
        self.assertEqual(json.loads(plan['execution_spec'])['selection'], 'shuffled')
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
            draft = json.loads(evaluation.paper_grading_plan('Grade papers')['execution_spec'])
            with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', AsyncMock(return_value=draft)):
                response = client.post('/api/benchmark/suggest', json=dict(goal='I want the best model for grading papers'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['method'], 'numeric')
            self.assertIsNone(exchange.market['dataset'])

    def test_general_planner_uses_dataset_context_without_reference_keys(self):
        dataset = exchange.market['dataset']
        response = evaluation.BenchmarkProtocol(method='exact', instructions='Classify each input', procedure='Compare ticket labels against references.').model_dump()
        mock = AsyncMock(return_value=response)
        with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', mock):
            result = asyncio.run(evaluation.suggest('Classify tickets', dataset))
        sent = json.loads(mock.call_args.args[0])
        self.assertEqual(sent['dataset']['count'], 20)
        self.assertEqual(sent['dataset']['question_samples'][0], dataset['problems'][0]['question'])
        self.assertNotIn('\"answer\":', mock.call_args.args[0])
        self.assertEqual(result['goal'], 'Classify tickets')


    def test_execution_string_controls_real_calls_scoring_and_holdout(self):
        dataset = exchange.market['dataset']
        for p in dataset['problems']:
            p['answer'] = '10'
        protocol = evaluation.BenchmarkProtocol(method='numeric', batch_size=10, instructions='Grade each paper.',
            selection='shuffled', repetitions=3, tolerance=1).model_dump()
        # The execution string overrides conflicting legacy fields.
        body = dict(goal='Find a reliable grader', method='exact', repetitions=1,
                    execution_spec=json.dumps(protocol))
        with TestClient(exchange.app) as client:
            response = client.put('/api/benchmark', json=body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['method'], 'numeric')
            self.assertEqual(response.json()['repetitions'], 3)
            self.assertEqual(exchange.restore()['dataset']['benchmark_plan']['execution_spec'], response.json()['execution_spec'])
        state = exchange.market
        state.update(round=1, mode='live')
        calls = []
        async def respond(questions, instructions, **kwargs):
            calls.append((json.loads(questions), instructions))
            return dict(answers=[9] * 10, _total_tokens=100)
        graded = AsyncMock(return_value=dict(grades=[dict(id=i, correct=True, score=100, reason='Equivalent') for i in range(10)]))
        with patch.object(exchange, 'ask', side_effect=respond) as ask, patch.object(providers, 'ask', graded):
            asyncio.run(exchange.benchmark(state))
            self.assertEqual(ask.call_count, 9)
            public = set(calls[0][0])
            self.assertTrue(all(set(q) == public for q, _ in calls))
            self.assertNotIn(body['goal'], calls[0][1])
            self.assertTrue(all(isinstance(question, str) for question in calls[0][0]))
            for worker in state['workers']:
                score = worker['scores'][0]
                self.assertEqual(score['attempted'], 30)
                self.assertEqual(score['total_tokens'], 300)
                self.assertEqual(worker['score'], 100)
                self.assertEqual(worker['diagnostics']['repeat_agreement'], 100)
                self.assertAlmostEqual(worker['diagnostics']['mean_absolute_error'], 1)
                self.assertAlmostEqual(worker['diagnostics']['grading_bias'], -1)
                self.assertEqual([a['attempt'] for a in worker['answers']], [1]*10 + [2]*10 + [3]*10)
            calls.clear()
            # The next round must draw a disjoint batch, which is what the holdout used to guarantee.
            state['round'] = 2
            asyncio.run(exchange.benchmark(state))
            self.assertTrue(public.isdisjoint(calls[0][0]))
        self.assertEqual(evaluation.select_problems(dataset, 0, response.json()), evaluation.select_problems(dataset, 0, response.json()))
        self.assertEqual(dataset['problems'][0]['question'], 'Input 0')

    def test_invalid_or_unsupported_execution_plans_do_not_persist(self):
        with TestClient(exchange.app) as client:
            for protocol in [dict(repetitions=6), dict(repetitions=True), dict(selection='invent tests'), dict(run_python='print(1)')]:
                response = client.put('/api/benchmark', json=dict(goal='Test', execution_spec=json.dumps(protocol)))
                self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(client.put('/api/benchmark', json=dict(goal='Test', execution_spec='not JSON')).status_code, 422)
            unsupported = dict(unsupported_requirements=['Needs image inputs'])
            response = client.put('/api/benchmark', json=dict(goal='Test', execution_spec=json.dumps(unsupported)))
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('benchmark_plan', exchange.market['dataset'])

    def test_open_ended_plan_saves_without_extra_criteria(self):
        # Extra criteria are optional now: the reference answer is the ground truth Gemini compares against.
        with TestClient(exchange.app) as client:
            saved = client.put('/api/benchmark', json=dict(goal='Summarize faithfully',
                               execution_spec=json.dumps(dict(method='rubric', rubric=''))))
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()['evaluator'], dict(provider='gemini', model=providers.model_for('gemini')))

    def test_repeat_disagreement_and_invalid_numeric_diagnostics(self):
        answers = [dict(answer=10, expected=10) for _ in range(20)]
        answers[10]['answer'] = 12
        answers[11]['answer'] = 'invalid'
        metrics = evaluation.diagnostics(answers, dict(method='numeric', repetitions=2))
        self.assertEqual(metrics['repeat_agreement'], 80)
        self.assertEqual(metrics['numeric_valid_count'], 19)
        self.assertAlmostEqual(metrics['mean_absolute_error'], 2/19)
        self.assertAlmostEqual(metrics['grading_bias'], 2/19)

    def test_planner_rejects_invented_backend_operations(self):
        with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', AsyncMock(return_value={**evaluation.BenchmarkProtocol().model_dump(), 'run_python': 'arbitrary'})):
            with self.assertRaises(ValueError):
                asyncio.run(evaluation.suggest('Test a model'))


    def test_planner_must_supply_execution_settings(self):
        with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', AsyncMock(return_value=dict(method='exact', instructions='Do the task'))):
            with self.assertRaisesRegex(ValueError, 'required execution settings'):
                asyncio.run(evaluation.suggest('Test a model'))

    def test_missing_usage_on_a_repeat_is_not_reported_as_complete(self):
        state = exchange.market
        state.update(round=1, mode='live')
        state['dataset']['benchmark_plan'] = evaluation.BenchmarkPlan(goal='Classify', repetitions=2, batch_size=10).model_dump()
        calls = {}
        async def respond(*args, **kwargs):
            model = kwargs['model']
            calls[model] = calls.get(model, 0) + 1
            return dict(answers=['reference'] * 10, _total_tokens=100 if calls[model] == 1 else None)
        graded = AsyncMock(return_value=dict(grades=[dict(id=i, correct=True, score=100, reason='Equivalent') for i in range(10)]))
        with patch.object(exchange, 'ask', side_effect=respond), patch.object(providers, 'ask', graded):
            asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(w['scores'][0]['total_tokens'] is None for w in state['workers']))
