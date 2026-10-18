import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteHistory } from './history-api.mjs';

test('deleting history requires confirmation, identifies one quiz, and only notifies after success', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [], events = [];
  globalThis.window = { confirm: () => false, dispatchEvent: event => events.push(event) };
  globalThis.fetch = async (...args) => { requests.push(args); return Response.json({ status: 'deleted' }); };
  const entry = { session_id: 'class/one', round: 2 };
  try {
    assert.equal(await deleteHistory(entry), false);
    assert.equal(requests.length, 0);
    window.confirm = () => true;
    assert.equal(await deleteHistory(entry), true);
    assert.deepEqual(requests[0], ['/api/history/class%2Fone/2', { method: 'DELETE' }]);
    assert.equal(events[0].type, 'history-changed');
    assert.deepEqual(events[0].detail, entry);
    assert.equal(requests.length, 1, 'deleting must only send the DELETE request');
    globalThis.fetch = async () => Response.json({ detail: 'Saved quiz not found' }, { status: 404 });
    await assert.rejects(deleteHistory(entry), /Saved quiz not found/);
    assert.equal(events.length, 1);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
