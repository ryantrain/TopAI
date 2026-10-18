'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import Sidebar from '../sidebar';
import ReportCard from '../report-card';
import WorksheetModal from '../worksheet-modal';
import { loadHistory } from '../history-cache.mjs';
import { modelMetrics, withAspects } from '../model-metrics.mjs';
import { deleteHistory } from '../history-api.mjs';

const PAGE_SIZE = 30;
const date = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z').toLocaleString();

export default function HistoryPage({ savedSessionId, savedRound }) {
  const [entries, setEntries] = useState([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [worker, setWorker] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const request = useRef(0);
  const closeSheet = useCallback(() => setWorker(null), []);

  const refresh = useCallback(async (force = false) => {
    const id = ++request.current;
    setBusy(true); setError(''); setDeleted(false); setEntries([]); setMore(false); setSnapshot(null); setWorker(null);
    try {
      const rows = await loadHistory(`/api/history?offset=${offset}&limit=${PAGE_SIZE + 1}`, { force });
      if (id === request.current) { setEntries(rows.slice(0, PAGE_SIZE)); setMore(rows.length > PAGE_SIZE); }
    } catch (e) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setBusy(false); }
  }, [offset]);
  const open = useCallback(async (entry, force = false) => {
    const id = ++request.current;
    setBusy(true); setError(''); setDeleted(false); setSnapshot(null); setWorker(null);
    try {
      const data = await loadHistory(`/api/history/${encodeURIComponent(entry.session_id)}/${entry.round}`, { force });
      if (id === request.current) setSnapshot(data);
    } catch (e) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setBusy(false); }
  }, []);
  useEffect(() => {
    if (savedSessionId) open({ session_id: savedSessionId, round: savedRound });
    else refresh();
    return () => { request.current++; };
  }, [refresh, open, savedSessionId, savedRound]);
  useEffect(() => {
    const changed = event => {
      const removed = event.detail;
      setEntries(previous => previous.filter(entry => entry.session_id !== removed.session_id || String(entry.round) !== String(removed.round)));
      const matches = entry => entry?.session_id === removed.session_id && String(entry.round) === String(removed.round);
      if (matches(snapshot) || matches({ session_id: savedSessionId, round: savedRound })) {
        request.current++; setBusy(false); setSnapshot(null); setWorker(null); setDeleted(true);
      }
    };
    window.addEventListener('history-changed', changed);
    return () => window.removeEventListener('history-changed', changed);
  }, [snapshot, savedSessionId, savedRound]);

  async function remove(entry) {
    setDeleting(true); setError('');
    try { await deleteHistory(entry); }
    catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }

  const savedWorkers = snapshot?.workers || [];
  const rows = snapshot ? withAspects(modelMetrics(savedWorkers)) : [];
  return <div className="shell">
    <Sidebar/>
    <div className="workspace"><main className="stage history-page">
      <header className="page-head"><div><h1>Run history</h1><p>Every completed quiz is saved automatically. Starting a new class keeps these results.</p></div>
        {!(savedSessionId && deleted) && <button className="quiet-button" type="button" onClick={() => savedSessionId ? open({ session_id: savedSessionId, round: savedRound }, true) : refresh(true)} disabled={busy}>Refresh</button>}
      </header>
      {error && <div className="notice" role="alert">{error} Try Refresh to load history again.</div>}
      {busy && <p role="status">Loading saved results…</p>}
      {deleted && <p role="status">Quiz deleted. <Link href="/history">View all history</Link> or choose another run from the sidebar.</p>}
      {!savedSessionId && !busy && !error && entries.length === 0 && <p>No saved quizzes here yet. <Link href="/">Run a quiz in the classroom</Link> to save your first result.</p>}
      {!savedSessionId && entries.length > 0 && <div className="table-wrap"><table className="history-table">
        <caption>Completed quizzes, newest first</caption>
        <thead><tr><th>Saved</th><th>Worksheet</th><th>Quiz</th><th>Mode</th><th>Agent scores</th><th><span className="sr-only">View results</span></th></tr></thead>
        <tbody>{entries.map(entry => <tr key={`${entry.session_id}:${entry.round}`}>
          <td>{date(entry.recorded_at)}</td><td>{entry.dataset || '—'}</td><td>{entry.round}</td><td>{entry.mode === 'demo' ? 'Simulated demo' : entry.mode === 'live' ? 'Live models' : '—'}</td>
          <td>{(entry.workers || []).map(w => `${w.name}: ${w.score ?? '—'}${w.score == null ? '' : '%'}`).join(' · ') || 'Open results for agent scores'}</td>
          <td><div className="history-row-actions"><button className="quiet-button" type="button" onClick={() => open(entry)} disabled={busy || deleting} aria-label={`View quiz ${entry.round} saved ${date(entry.recorded_at)}`}>View results</button><button className="history-delete" type="button" onClick={() => remove(entry)} disabled={busy || deleting} aria-label={`Delete quiz ${entry.round} saved ${date(entry.recorded_at)}`}><Trash2 size={16}/></button></div></td>
        </tr>)}</tbody>
      </table></div>}
      {!savedSessionId && <nav className="history-pagination" aria-label="History pages">
        <button className="quiet-button" type="button" disabled={busy || offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>Newer</button>
        <span>Page {offset / PAGE_SIZE + 1}</span>
        <button className="quiet-button" type="button" disabled={busy || !more} onClick={() => setOffset(offset + PAGE_SIZE)}>Older</button>
      </nav>}
      {snapshot && <section className="history-results" aria-label="Saved quiz results" aria-live="polite">
        <div className="history-summary">
          <div className="history-summary-top"><div><span className="history-mode">{snapshot.mode === 'demo' ? 'Simulated demo' : 'Live models'}</span><h2>Quiz {snapshot.round}</h2><p className="history-worksheet">{snapshot.dataset?.name || 'Built-in math'}</p></div>
            <button className="quiet-button history-delete-button" type="button" disabled={busy || deleting} onClick={() => remove(snapshot)}><Trash2 size={15}/>{deleting ? 'Deleting…' : 'Delete quiz'}</button>
          </div>
          <dl className="history-meta"><div><dt>Agents compared</dt><dd>{savedWorkers.length}</dd></div><div><dt>Results include</dt><dd>Quizzes 1–{snapshot.round}</dd></div><div><dt>Worksheet questions</dt><dd>{snapshot.dataset?.count ?? 'Built-in set'}</dd></div></dl>
          {snapshot.dataset?.benchmark_plan?.goal && <div className="history-task"><h3>Task</h3><p>{snapshot.dataset.benchmark_plan.goal}</p></div>}
          <details className="history-reference"><summary>Session reference</summary><code>{snapshot.session_id}</code></details>
        </div>
        <ReportCard rows={rows} onSelect={id => setWorker(savedWorkers.find(w => w.id === id))}/>
      </section>}
    </main></div>
    {worker && <WorksheetModal worker={worker} onClose={closeSheet}/>}
  </div>;
}
