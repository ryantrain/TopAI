"""LaTeX integral imports keep their rubric plan, without model calls in tests."""
import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from backend import test_evaluation
from backend.test_session import exchange
from backend import datasets, evaluation, providers
from fastapi.testclient import TestClient


class LatexMathCheck(unittest.TestCase):
    setUp = test_evaluation.EvaluationCheck.setUp
    tearDown = test_evaluation.EvaluationCheck.tearDown

    def rows(self):
        return [dict(id=i, topic='Integration', question=rf'Evaluate: \int x^{i} dx',
                     answer=rf'\frac{{x^{i+1}}}{{{i+1}}} + C' if i % 2 else '1') for i in range(20)]

    def test_import_keeps_pairs_and_installs_persisted_math_plan(self):
        raw = json.dumps(self.rows())
        for scoring in ('exact', 'numeric'):
            with patch.dict(os.environ, {'GEMINI_API_KEY': '', 'OPENAI_API_KEY': ''}), TestClient(exchange.app) as client:
                response = client.post(f'/api/dataset?filename=integrals.json&scoring={scoring}', content=raw)
                self.assertEqual(response.status_code, 200, response.text)
                dataset = exchange.session['dataset']
                self.assertEqual(dataset['problems'], [{k: r[k] for k in ('question', 'answer')} for r in self.rows()])
                plan = response.json()['benchmark_plan']
                self.assertEqual(plan['method'], 'rubric')
                self.assertIn('integration constant', plan['rubric'])
                self.assertEqual(plan['evaluator'], dict(provider='ollama', model=exchange.providers.model_for('ollama')))
                self.assertEqual(exchange.restore()['dataset']['benchmark_plan'], plan)
                self.assertEqual(json.loads(plan['execution_spec'])['method'], 'rubric')

    def test_planner_receives_references_for_symbolic_math(self):
        dataset = datasets.parse_dataset(json.dumps(self.rows()).encode(), 'integrals.json', 'exact')
        protocol = evaluation.BenchmarkProtocol(method='rubric', instructions='Solve each integral.').model_dump()
        with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', AsyncMock(return_value=protocol)) as ask:
            plan = asyncio.run(evaluation.suggest('Solve integrals', dataset))
        context = json.loads(ask.call_args.args[0])
        self.assertEqual(context['dataset']['answer_samples'][1], self.rows()[1]['answer'])
        self.assertEqual(plan['method'], 'rubric')
        self.assertEqual(json.loads(plan['execution_spec'])['method'], 'rubric')
        self.assertNotIn(self.rows()[1]['answer'], plan['instructions'])

    def test_generation_instructions_are_not_replaced_by_solving_template(self):
        dataset = datasets.parse_dataset(json.dumps(self.rows()).encode(), 'integrals.json', 'exact')
        dataset['instructions'] = 'Solve each supplied integral.'
        goal = 'Create a set of three integral problems based on each dataset example, without solutions.'
        for method in ('exact', 'rubric'):
            protocol = evaluation.BenchmarkProtocol(
                method=method, instructions=goal, procedure='Generate three new problems per example.',
                rubric='Check relevance, difficulty and three distinct problems; no solutions.').model_dump()
            with patch.object(providers, 'local_models_ready', AsyncMock()), patch.object(providers, 'ask', AsyncMock(return_value=protocol)) as ask:
                plan = asyncio.run(evaluation.suggest(goal, dataset))
            self.assertEqual(plan['goal'], goal)
            self.assertEqual(plan['instructions'], goal)
            self.assertEqual(json.loads(plan['execution_spec'])['instructions'], goal)
            self.assertEqual(plan['rubric'], protocol['rubric'])
            self.assertNotIn('math_template', json.loads(ask.call_args.args[0]))
            self.assertIn('not solve the existing integrals', ask.call_args.args[1])

    def test_detection_leaves_other_datasets_alone(self):
        self.assertIsNone(evaluation.latex_math_plan('Classify', exchange.session['dataset']))
        with self.assertRaises(ValueError):
            datasets.parse_dataset(json.dumps([dict(question=f'Label {i}', answer='text') for i in range(20)]).encode(), 'labels.json', 'numeric')
        with self.assertRaises(ValueError):
            datasets.parse_dataset(json.dumps(self.rows() + [self.rows()[0]]).encode(), 'integrals.json', 'exact')
