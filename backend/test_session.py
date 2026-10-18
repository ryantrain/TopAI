"""Run with: python -m unittest backend.test_session -v."""
import asyncio
import copy
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

scratch = tempfile.TemporaryDirectory()
os.environ['EVALUATION_DB'] = str(Path(scratch.name) / 'test.sqlite3')
os.environ['DATABASE_URL'] = ''
from backend import main as exchange
from backend import providers
from fastapi.testclient import TestClient


class SessionCheck(unittest.TestCase):
    def test_live_quiz_keeps_display_label_out_of_provider_arguments(self):
        state = exchange.initial_state()
        state.update(mode='live', round=1)
        state['dataset'] = dict(scoring='numeric', problems=exchange.demo_problems(101))
        state['workers'] = exchange.worker_rows(1, ['Ada'])
        state['configuration'] = dict(cost_per_1k_tokens=[None], workers=[dict(
            provider='openai', model='test-model', label='Ada', credential_id='test-credential')])
        calls = []

        schemas = []

        async def ask(prompt, instruction, *, provider, model, credential_id, with_usage, schema):
            calls.append((provider, model, credential_id, with_usage))
            schemas.append(schema)
            return dict(answers=[0] * 10, _total_tokens=100)

        with patch.object(exchange, 'ask', ask):
            asyncio.run(exchange.benchmark(state))
        self.assertEqual(calls, [('openai', 'test-model', 'test-credential', True)])
        self.assertEqual(state['workers'][0]['label'], 'Ada')
        # The structured response is enforced too, and numeric scoring asks for numeric answers.
        self.assertEqual(schemas[0]['required'], ['answers'])
        self.assertEqual(schemas[0]['properties']['answers']['items'], {'type': 'number'})
        self.assertEqual(len(state['workers'][0]['answers']), 10)

    def test_complete_quiz_and_persistence(self):
        state = exchange.initial_state()
        state['round'] = 1
        asyncio.run(exchange.benchmark(state))
        self.assertTrue(all(len(w['answers']) == 10 for w in state['workers']))
        self.assertTrue(all(w['scores'][0]['stage'] == 'quiz' for w in state['workers']))
        state['phase'] = 'complete'
        exchange.persist(state)
        self.assertEqual(exchange.restore(), state)

    def test_restore_keeps_only_session_fields(self):
        state = exchange.initial_state()
        state.update(unexpected_old_field={})
        exchange.persist(state)
        restored = exchange.restore()
        self.assertNotIn('unexpected_old_field', restored)

    def test_failed_quiz_rolls_back(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        before = copy.deepcopy(exchange.session)
        async def fail(state):
            state['workers'][0]['score'] = 1
            raise ValueError('test failure')
        with patch.object(exchange, 'benchmark', fail):
            asyncio.run(exchange.run_round())
        self.assertEqual(exchange.session['workers'], before['workers'])
        self.assertEqual(exchange.session['round'], 0)
        self.assertFalse(exchange.session['running'])
        self.assertEqual(exchange.session['phase'], 'error')

    def test_failed_quiz_names_http_provider_and_status(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        async def fail(state):
            response = exchange.httpx.Response(429, request=exchange.httpx.Request('POST', 'https://generativelanguage.googleapis.com/v1beta/models/test'))
            raise exchange.httpx.HTTPStatusError('quota', request=response.request, response=response)
        with patch.object(exchange, 'benchmark', fail):
            asyncio.run(exchange.run_round())
        self.assertIn('Gemini HTTP 429', exchange.session['error'])

    def test_multiple_quizzes_stop_after_failure(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        calls = 0
        async def fail_on_second():
            nonlocal calls
            calls += 1
            exchange.session.update(running=False, phase='error' if calls == 2 else 'complete')
        with patch.object(exchange, 'run_round', fail_on_second):
            asyncio.run(exchange.run_rounds(3))
        self.assertEqual(calls, 2)

    def test_selected_quiz_count_in_both_modes(self):
        async def check(mode, count):
            exchange.session.clear()
            exchange.session.update(exchange.initial_state())
            response = await exchange.start_round(exchange.StartRequest(mode=mode, rounds=count))
            self.assertEqual(response['rounds'], count)
            await exchange.task
            self.assertEqual(exchange.session['round'], count)
            self.assertEqual(exchange.session['phase'], 'complete')
        async def benchmark(state):
            for worker in state['workers']:
                worker['score'] = 80
        with patch.object(exchange.providers, 'readiness', return_value=[]), patch.object(exchange, 'benchmark', benchmark):
            for mode in ('demo', 'live'):
                for count in (1, 3, 10):
                    with self.subTest(mode=mode, quizzes=count):
                        asyncio.run(check(mode, count))

    def test_demo_run_only_uses_selected_agents(self):
        async def check():
            exchange.session.clear()
            exchange.session.update(exchange.initial_state())
            await exchange.start_round(exchange.StartRequest(mode='demo', agent_ids=['nova']))
            self.assertEqual([worker['id'] for worker in exchange.session['workers']], ['nova'])
            exchange.task.cancel()
            try:
                await exchange.task
            except asyncio.CancelledError:
                pass
            exchange.session['running'] = False
        asyncio.run(check())

    def test_api_boundaries(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        with TestClient(exchange.app) as client:
            self.assertEqual(client.get('/api/session').status_code, 200)
            self.assertEqual(client.get('/api/market').status_code, 404)
            self.assertEqual(client.post('/api/rounds', json={'mode': 'invalid'}).status_code, 422)
            self.assertEqual(client.post('/api/rounds', json={'rounds': 11}).status_code, 422)

    def test_browser_agent_setup_is_public_but_credentials_are_not(self):
        exchange.session.clear()
        exchange.session.update(exchange.initial_state())
        secret = 'secret-never-returned'
        try:
            with TestClient(exchange.app) as client:
                response = client.post('/api/agents', json={'agents': [
                    {'provider': 'openai', 'model': 'gpt-test', 'label': 'Integral Ace', 'api_key': secret},
                    {'provider': 'gemini', 'model': 'gemini-test', 'label': 'Math Scout', 'api_key': 'gemini-secret'},
                ]})
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(len(payload['configuration']['workers']), 2)
                self.assertNotIn(secret, response.text)
                self.assertNotIn('gemini-secret', response.text)
                self.assertNotIn('credential_id', response.text)
                current = client.get('/api/session')
                self.assertEqual(current.status_code, 200)
                self.assertEqual(len(current.json()['workers']), 2)
                self.assertEqual([worker['label'] for worker in current.json()['workers']], ['Integral Ace', 'Math Scout'])
                self.assertEqual(len(current.json()['demo_workers']), 3)
                self.assertEqual(current.json()['integrations']['agent_source'], 'browser')
                self.assertNotIn(secret, current.text)
                self.assertNotIn('credential_id', current.text)
        finally:
            providers.clear_agent_configuration()

    def test_labeled_agents_call_providers_with_connection_fields_only(self):
        # autospec keeps ask's real signature, so an extra field such as the display label fails like it does live.
        async def answer(*args, **kwargs):
            return {'answers': [str(i) for i in range(10)], '_total_tokens': 100}
        try:
            config = providers.configure_agents([
                {'provider': 'openai', 'model': 'gpt-test', 'label': 'Integral Ace', 'api_key': 'secret-one'},
                {'provider': 'anthropic', 'model': 'claude-test', 'label': 'Math Scout', 'api_key': 'secret-two'},
            ])
            state = exchange.initial_state()
            state.update(round=1, mode='live', configuration=config, workers=exchange.worker_rows(2, ['Integral Ace', 'Math Scout']),
                         dataset=dict(name='quiz', scoring='exact', count=10, instructions='', digest='d',
                                      problems=[dict(question=f'Question {i}', answer=str(i)) for i in range(10)]))
            with patch.object(exchange, 'ask', autospec=True, side_effect=answer) as ask:
                asyncio.run(exchange.benchmark(state))
            self.assertEqual(ask.call_count, 2)
            self.assertTrue(all('label' not in call.kwargs for call in ask.call_args_list))
            self.assertEqual([call.kwargs['provider'] for call in ask.call_args_list], ['openai', 'anthropic'])
            self.assertTrue(all(w['score'] == 100 for w in state['workers']))
        finally:
            providers.clear_agent_configuration()

    def test_scoring_parser(self):
        self.assertEqual(exchange.number('reasoning\n#### 1,200'), 1200)
        self.assertEqual(exchange.number('$10.50'), 10.5)
        for invalid in ['NaN', 'Infinity', '4 or 5', None]:
            with self.assertRaises(ValueError):
                exchange.number(invalid)


if __name__ == '__main__':
    unittest.main()
