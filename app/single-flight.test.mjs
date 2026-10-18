import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight.mjs';

test('slow polling still delivers completion, without accumulating requests', async () => {
  let release;
  let calls = 0;
  const poll = singleFlight(async () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  });
  const first = poll();
  await Promise.resolve();
  const later = Array.from({ length: 10 }, () => poll());
  assert.equal(calls, 1);
  assert.ok(later.every(request => request === first));
  release({ running: false, phase: 'complete' });
  assert.deepEqual(await first, { running: false, phase: 'complete' });
  const next = poll();
  await Promise.resolve();
  assert.equal(calls, 2);
  release({ running: false, phase: 'error' });
  assert.equal((await next).phase, 'error');
});

test('a failed request releases the next poll', async () => {
  let calls = 0;
  const poll = singleFlight(async () => {
    if (++calls === 1) throw new Error('timeout');
    return 'reconnected';
  });
  await assert.rejects(poll(), /timeout/);
  assert.equal(await poll(), 'reconnected');
});
