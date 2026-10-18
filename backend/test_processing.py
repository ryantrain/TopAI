"""Regression checks for stalled inference and abandoned benchmark tasks."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from backend.test_market import exchange
from backend import evaluation, providers


class ProcessingCheck(unittest.IsolatedAsyncioTestCase):
    def state(self, mode):
        state = exchange.initial_state()
        state.update(mode=mode, round=1, dataset=dict(count=20, scoring='exact',
            problems=[dict(question=f'Question {i}', answer='reference') for i in range(20)],
            benchmark_plan=evaluation.BenchmarkPlan(goal='Evaluate answers', method='rubric').model_dump()))
        return state

    async def test_demo_with_custom_rubric_never_calls_a_model(self):
        state = self.state('demo')
        with patch.object(exchange, 'ask', AsyncMock(side_effect=AssertionError('worker called'))) as worker, \
             patch.object(providers, 'ask', AsyncMock(side_effect=AssertionError('judge called'))) as judge:
            await asyncio.wait_for(exchange.benchmark(state), 1)
        worker.assert_not_called()
        judge.assert_not_called()
        self.assertTrue(all(len(w['answers']) == 20 and w['status'] == 'Complete' for w in state['workers']))

    async def test_failed_worker_cancels_other_inference_before_returning(self):
        started = 0
        cancelled = []
        all_started = asyncio.Event()

        async def answer(*args, **kwargs):
            nonlocal started
            started += 1
            index = started
            if started == 3:
                all_started.set()
            await all_started.wait()
            if index == 1:
                raise ValueError('invalid model answer')
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(index)

        with patch.object(exchange, 'ask', answer):
            with self.assertRaisesRegex(ValueError, 'invalid model answer'):
                await asyncio.wait_for(exchange.benchmark(self.state('live')), 1)
        self.assertEqual(sorted(cancelled), [2, 3])

    async def test_local_inference_is_serial_and_timeout_releases_slot(self):
        active = 0
        peak = 0

        async def respond(request):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                await asyncio.sleep(0.02)
                return httpx.Response(200, json=dict(done=True, message=dict(content='{"ok":true}')))
            finally:
                active -= 1

        real_client = httpx.AsyncClient
        with patch.object(providers, 'local_inference_lock', asyncio.Lock()), \
             patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw)):
            results = await asyncio.gather(*(providers.ask_local('q', 'i', 'local-test') for _ in range(3)))
            self.assertEqual(peak, 1)
            self.assertEqual(results, [{'ok': True}] * 3)
            with self.assertRaises(TimeoutError):
                await providers.ask_local('q', 'i', 'local-test', timeout=0.001)
            self.assertFalse(providers.local_inference_lock.locked())
            self.assertEqual(await providers.ask_local('q', 'i', 'local-test'), {'ok': True})
