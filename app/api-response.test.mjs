import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from './api-response.mjs';

test('returns successful uploads and criteria', async () => {
  assert.deepEqual(await readApiResponse(Response.json({ count: 20 })), { count: 20 });
});

test('shows backend validation and session errors', async () => {
  await assert.rejects(readApiResponse(Response.json({ detail: [
    { loc: ['body', 'rubric'], msg: 'Field required' },
  ] }, { status: 422 })), /rubric: Field required/);
  await assert.rejects(readApiResponse(Response.json({ detail: 'Start a new session' }, { status: 409 })), /Start a new session/);
});

test('explains a non-JSON proxy failure', async () => {
  await assert.rejects(readApiResponse(new Response('Bad Gateway', { status: 502 })), /backend is running/);
});
