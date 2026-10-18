'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Database, History, LayoutGrid, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import { loadHistory } from './history-cache.mjs';
import { deleteHistory } from './history-api.mjs';

const PAGES = [['/', 'Classroom', LayoutGrid], ['/datasets', 'Datasets', Database], ['/history', 'Run history', History]];
const savedTime = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export default function Sidebar({ children }) {
  const path = usePathname();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const latest = useRef(0);
  const refresh = useCallback(async (force = false) => {
    const id = ++latest.current;
    try {
      const data = await loadHistory('/api/history?limit=30', { force });
      if (id === latest.current) { setEntries(data); setError(''); }
    } catch { if (id === latest.current) setError('History could not load.'); }
  }, []);
  useEffect(() => {
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(tick, 10000);
    window.addEventListener('focus', tick);
    const changed = event => {
      const removed = event.detail;
      setEntries(previous => previous?.filter(entry => entry.session_id !== removed.session_id || String(entry.round) !== String(removed.round)) ?? previous);
    };
    window.addEventListener('history-changed', changed);
    return () => { latest.current++; clearInterval(timer); window.removeEventListener('focus', tick); window.removeEventListener('history-changed', changed); };
  }, [refresh]);
  async function remove(entry) {
    setDeleting(true); setError('');
    try { await deleteHistory(entry); }
    catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }
  return <aside className="sidebar">
    <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"/>TopAI</Link>
    <nav className="side-nav" aria-label="Dashboard">
      {PAGES.map(([href, label, Icon]) => <Link key={href} href={href} className={path === href ? 'on' : ''} aria-current={path === href ? 'page' : undefined}><Icon size={15}/>{label}</Link>)}
    </nav>
    <section className="sidebar-history" aria-label="Recent runs">
      <div className="sidebar-history-head"><h2>Recent runs</h2><button type="button" onClick={() => refresh(true)} aria-label="Refresh recent runs"><RefreshCw size={14}/></button></div>
      {error && <p className="sidebar-history-note" role="status">{error} <button type="button" onClick={() => refresh(true)}>Retry</button></p>}
      {!error && entries === null && <p className="sidebar-history-note" role="status">Loading history…</p>}
      {entries?.length === 0 && <p className="sidebar-history-note">Your completed runs will appear here.</p>}
      <nav className="history-links" aria-label="Saved runs">
        {(entries || []).map(entry => {
          const href = `/history/${encodeURIComponent(entry.session_id)}/${entry.round}`;
          const title = `Quiz ${entry.round}${entry.dataset ? ` · ${entry.dataset}` : ''}`;
          return <div className={`history-link-row${path === href ? ' on' : ''}`} key={`${entry.session_id}:${entry.round}`}><Link href={href} aria-current={path === href ? 'page' : undefined} title={`${title} · ${entry.recorded_at}`}>
            <MessageSquare size={15} aria-hidden="true"/><span><strong>{title}</strong><small>{savedTime(entry.recorded_at)}{entry.mode === 'demo' ? ' · Demo' : ''}</small></span>
          </Link><button className="history-delete" type="button" aria-label={`Delete ${title} saved ${savedTime(entry.recorded_at)}`} title="Delete saved quiz" disabled={deleting} onClick={() => remove(entry)}><Trash2 size={14}/></button></div>;
        })}
      </nav>
      {entries?.length > 0 && <Link className="history-all" href="/history">View all history</Link>}
    </section>
    {children}
  </aside>;
}
