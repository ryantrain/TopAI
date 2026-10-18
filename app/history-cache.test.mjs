import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearHistoryCache, loadHistory, removeHistoryFromCache } from './history-cache.mjs';

test('history cache reuses results, forces refresh, expires and tolerates storage failures', async () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ run: ++calls }) });
  try {
    clearHistoryCache();
    const url = '/api/history/session/1';
    const [first, duplicate] = await Promise.all([loadHistory(url), loadHistory(url)]);
    assert.deepEqual(first, duplicate);
    assert.equal(calls, 1);
    assert.deepEqual(await loadHistory(url), first);
    assert.equal(calls, 1);
    assert.deepEqual(await loadHistory(url, { force: true }), { run: 2 });
    clearHistoryCache();
    await loadHistory(url);
    assert.equal(calls, 3);
    const key = [...values.keys()][0];
    const entries = JSON.parse(values.get(key));
    entries[0].expires = 0;
    values.set(key, JSON.stringify(entries));
    await loadHistory(url);
    assert.equal(calls, 4);
    values.set(key, '{broken');
    await loadHistory(url);
    assert.equal(calls, 5);
    sessionStorage.getItem = () => { throw new Error('blocked'); };
    sessionStorage.setItem = () => { throw new Error('quota'); };
    assert.deepEqual(await loadHistory(url), { run: 6 });
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ detail: 'Missing run' }) });
    await assert.rejects(loadHistory(url), /Missing run/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.sessionStorage;
  }
});

test('deletion updates cached lists without fetching and filters older requests still in flight', async () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const originalFetch = globalThis.fetch;
  const removed = { session_id: 'remove-me', round: 1 };
  const kept = { session_id: 'keep-me', round: 1 };
  let calls = 0;
  globalThis.fetch = async url => { calls++; return Response.json(url.includes('?') ? [removed, kept] : removed); };
  try {
    clearHistoryCache();
    const sidebar = '/api/history?limit=30', page = '/api/history?offset=0&limit=31';
    await loadHistory(sidebar);
    await loadHistory(page);
    await loadHistory('/api/history/remove-me/1');
    removeHistoryFromCache(removed);
    assert.deepEqual(await loadHistory(sidebar), [kept]);
    assert.deepEqual(await loadHistory(page), [kept]);
    assert.equal(calls, 3, 'removing an entry must not reload either list');
    assert.ok(!JSON.parse([...values.values()][0]).some(entry => entry.url === '/api/history/remove-me/1'));

    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = loadHistory(sidebar, { force: true });
    removeHistoryFromCache(kept);
    finish(Response.json([removed, kept]));
    assert.deepEqual(await pending, [], 'an older response must not restore a deleted entry');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.sessionStorage;
  }
});
