import { removeHistoryFromCache } from './history-cache.mjs';
import { readApiResponse } from './api-response.mjs';

export async function deleteHistory(entry) {
  if (!window.confirm(`Delete quiz ${entry.round} from saved history? Your current class will stay unchanged.`)) return false;
  await readApiResponse(await fetch(`/api/history/${encodeURIComponent(entry.session_id)}/${entry.round}`, { method: 'DELETE' }));
  removeHistoryFromCache(entry);
  window.dispatchEvent(new CustomEvent('history-changed', { detail: entry }));
  return true;
}
