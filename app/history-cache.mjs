import { readApiResponse } from './api-response.mjs';

const KEY = 'runHistoryCacheV1';
const pending = new Map();
const deleted = new Set();
const identity = entry => `${entry.session_id}:${entry.round}`;
const filterDeleted = data => Array.isArray(data) ? data.filter(entry => !deleted.has(identity(entry))) : data;
let generation = 0;

function readCache() {
  try {
    const entries = JSON.parse(sessionStorage.getItem(KEY));
    return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.url === 'string' && entry.expires > Date.now() && entry.data != null) : [];
  } catch { return []; }
}

export function clearHistoryCache() {
  generation++;
  pending.clear();
  try { sessionStorage.removeItem(KEY); } catch {}
}

export function removeHistoryFromCache(entry) {
  deleted.add(identity(entry));
  generation++;
  pending.clear();
  const url = `/api/history/${encodeURIComponent(entry.session_id)}/${entry.round}`;
  const entries = readCache().filter(cached => cached.url !== url).map(cached => ({ ...cached, data: filterDeleted(cached.data) }));
  try { sessionStorage.setItem(KEY, JSON.stringify(entries)); } catch {}
}

export async function loadHistory(url, { force = false } = {}) {
  if (!force) {
    const cached = readCache().find(entry => entry.url === url);
    if (cached) return cached.data;
    if (pending.has(url)) return pending.get(url);
  }
  const version = generation;
  const request = (async () => {
    const data = filterDeleted(await readApiResponse(await fetch(url, { cache: 'no-store' })));
    if (!Array.isArray(data) && deleted.has(identity(data))) throw new Error('This saved quiz was deleted.');
    if (version === generation && pending.get(url) === request) {
      const ttl = url.includes('?') ? 10000 : 30 * 60 * 1000;
      const entries = [...readCache().filter(entry => entry.url !== url), { url, data, expires: Date.now() + ttl }].slice(-8);
      // Bound synchronous storage work as saved worksheets can be large.
      while (entries.length && JSON.stringify(entries).length > 1000000) entries.shift();
      try { sessionStorage.setItem(KEY, JSON.stringify(entries)); } catch {}
    }
    return data;
  })();
  pending.set(url, request);
  try { return await request; }
  finally { if (pending.get(url) === request) pending.delete(url); }
}
