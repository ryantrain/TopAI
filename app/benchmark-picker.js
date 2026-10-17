'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Loader2 } from 'lucide-react';
import { readApiResponse } from './api-response.mjs';

// Choose which saved worksheets make up the benchmark; several worksheets are merged into one question set.
export default function BenchmarkPicker({ market, mode, refresh, onError }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const root = useRef(null);
  const files = market?.library || [];
  const selection = market?.selection || [];
  const locked = !!market?.running || !!market?.round;
  const count = market?.selection_count || 0;
  const fallback = mode === 'demo' ? 'Generated math' : 'GSM8K math';
  const summary = selection.length > 1 ? `${selection.length} worksheets` : selection.length ? files.find(f => f.id === selection[0])?.name : market?.dataset?.name || fallback;

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  async function send(path, options) {
    setPending(true); onError('');
    try { await readApiResponse(await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })); await refresh(); }
    catch (e) { onError(e.message); }
    finally { setPending(false); }
  }
  const choose = (ids) => send('/api/library/selection', { method: 'PUT', body: JSON.stringify({ ids }) });
  const toggle = (id) => choose(selection.includes(id) ? selection.filter(i => i !== id) : [...selection, id]);
  const forget = (file) => { if (window.confirm(`Forget ${file.name}? It will be removed from this menu.`)) send(`/api/library/${file.id}`, { method: 'DELETE' }); };

  return <div className="picker" ref={root}>
    <button type="button" className="picker-button" aria-haspopup="true" aria-expanded={open} disabled={!market} onClick={() => setOpen(o => !o)}><FileText size={14}/><span>{summary}</span>{pending ? <Loader2 size={13} className="spin"/> : <ChevronDown size={13}/>}</button>
    {open && <div className="picker-menu" role="group" aria-label="Worksheets">
      <div className="picker-head"><strong>Worksheets</strong><span>Pick one or more</span></div>
      {locked && <p className="picker-note">This session’s benchmark is fixed. Start a new session to pick different worksheets.</p>}
      <label className="picker-option"><input type="checkbox" checked={!selection.length && !market?.dataset} disabled={locked || pending} onChange={() => choose([])}/><span><strong>Default benchmark</strong><small>{fallback} · built in</small></span></label>
      {files.map(f => <div className="picker-option" key={f.id}>
        <label><input type="checkbox" checked={selection.includes(f.id)} disabled={locked || pending} onChange={() => toggle(f.id)}/><span><strong>{f.name}</strong><small>{f.count} questions · {f.scoring === 'numeric' ? 'numeric' : 'text'} answers{f.model_answers ? ` · ${f.model_answers} without an answer key` : ''}</small></span></label>
        <button type="button" className="picker-forget" aria-label={`Forget ${f.name}`} disabled={pending || (locked && selection.includes(f.id))} onClick={() => forget(f)}>Forget</button>
      </div>)}
      {!files.length && <p className="picker-note">No worksheets yet. Upload one in “Your niche. Your benchmark.” below.</p>}
      <p className="picker-foot">{selection.length ? `${count} questions selected · ${Math.floor(count / 20)} ${Math.floor(count / 20) === 1 ? 'round' : 'rounds'} available${count < 20 ? ` · add ${20 - count} more to run` : ''}` : 'Each round uses 20 questions: 10 public and 10 held out.'}</p>
    </div>}
  </div>;
}
