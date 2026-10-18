'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, FileText, Loader2 } from 'lucide-react';
import { readApiResponse } from './api-response.mjs';

// Choose which saved worksheets make up the benchmark; several worksheets are merged into one question set.
export default function BenchmarkPicker({ market, disabled, refresh, onError }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const root = useRef(null);
  const files = market?.library || [];
  const selection = market?.selection || [];
  const locked = disabled || !!market?.running || !!market?.round;
  const count = market?.selection_count || 0;
  const summary = selection.length > 1 ? `${selection.length} datasets · ${count} q`
    : selection.length ? `${files.find(f => f.id === selection[0])?.name || 'Dataset'} · ${count} q`
    : 'Choose a dataset';

  useEffect(() => {
    if (!open) return;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !root.current?.contains(e.target)) setOpen(false); };
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
  const choose = ids => send('/api/library/selection', { method: 'PUT', body: JSON.stringify({ ids }) });
  const toggle = id => choose(selection.includes(id) ? selection.filter(i => i !== id) : [...selection, id]);
  const forget = file => { if (window.confirm(`Remove ${file.name} from your datasets?`)) send(`/api/library/${file.id}`, { method: 'DELETE' }); };

  return <div className="picker" ref={root}>
    <button type="button" className="chip action" aria-haspopup="true" aria-expanded={open} aria-label={`Datasets: ${summary}`} disabled={!market} onClick={() => setOpen(o => !o)}>
      <FileText size={13}/><span className="picker-summary">{summary}</span>{pending ? <Loader2 size={12} className="spin"/> : <ChevronDown size={12}/>}
    </button>
    {open && <div className="picker-menu" role="group" aria-label="Datasets">
      <div className="picker-head"><strong>Datasets</strong><span>Pick one or more</span></div>
      {locked && <p className="picker-note">Datasets are fixed for this class. Start a new class to change them.</p>}
      <label className="picker-option"><input type="checkbox" checked={!selection.length} disabled={locked || pending} onChange={() => choose([])}/>
        <span><strong>No dataset</strong><small>Select or upload at least 20 questions to run</small></span></label>
      {files.map(f => <div className="picker-option" key={f.id}>
        <label><input type="checkbox" checked={selection.includes(f.id)} disabled={locked || pending} onChange={() => toggle(f.id)}/>
          <span><strong>{f.name}</strong><small>{f.count} questions · {f.scoring === 'numeric' ? 'numeric' : 'text'} answers{f.model_answers ? ` · ${f.model_answers} answers worked out automatically, check them` : ''}</small></span></label>
        <button type="button" className="picker-forget" aria-label={`Remove ${f.name}`} disabled={pending || (locked && selection.includes(f.id))} onClick={() => forget(f)}>Remove</button>
      </div>)}
      {!files.length && <p className="picker-note">No datasets yet. Use + below, or the Datasets page.</p>}
      <p className="picker-foot">{selection.length ? `${count} questions selected · ${Math.floor(count / 20)} ${Math.floor(count / 20) === 1 ? 'quiz' : 'quizzes'} available${count < 20 ? ` · add ${20 - count} more to run` : ''}` : 'Each quiz uses 20 questions: 10 in Part A and 10 new ones in Part B.'}</p>
      <Link className="picker-manage" href="/datasets">Manage datasets</Link>
    </div>}
  </div>;
}
