'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { removeWorksheet, selectWorksheets } from './library-api.mjs';

export function selectionSummary(market) {
  const files = market?.library || [];
  const selection = market?.selection || [];
  const count = market?.selection_count || 0;
  return selection.length > 1 ? `${selection.length} worksheets · ${count} questions`
    : selection.length ? `${files.find(f => f.id === selection[0])?.name || 'Worksheet'} · ${count} questions`
    : '';
}

// Pick which saved worksheets the next class uses; several are merged into one question set.
// Opened from the composer's + button (marked data-picker-trigger).
export default function WorksheetMenu({ market, refresh, onError, onClose }) {
  const [pending, setPending] = useState(false);
  const root = useRef(null);
  const files = market?.library || [];
  const selection = market?.selection || [];
  const locked = !!market?.running || !!market?.round;
  const count = market?.selection_count || 0;

  useEffect(() => {
    const close = e => {
      if (e.type === 'keydown') { if (e.key === 'Escape') onClose(); return; }
      if (!root.current?.contains(e.target) && !e.target.closest?.('[data-picker-trigger]')) onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [onClose]);

  async function run(fn) {
    setPending(true); onError('');
    try { await fn(); await refresh(); } catch (e) { onError(e.message); }
    finally { setPending(false); }
  }
  const toggle = id => run(() => selectWorksheets(selection.includes(id) ? selection.filter(i => i !== id) : [...selection, id]));
  const forget = file => { if (window.confirm(`Remove ${file.name} from your worksheets?`)) run(() => removeWorksheet(file.id)); };

  return <div className="picker-menu" ref={root} role="group" aria-label="Worksheets">
    <div className="picker-head"><strong>Choose worksheets</strong><span>{pending ? <Loader2 size={12} className="spin"/> : 'Pick one or more'}</span></div>
    {locked && <p className="picker-note">Worksheets are fixed for this class. Start a new class to change them.</p>}
    {files.map(f => <div className="picker-option" key={f.id}>
      <label><input type="checkbox" checked={selection.includes(f.id)} disabled={locked || pending} onChange={() => toggle(f.id)}/>
        <span><strong>{f.name}</strong><small>{f.count} questions · {f.scoring === 'numeric' ? 'numeric' : 'text'} answers{f.model_answers ? ` · ${f.model_answers} answers worked out by AI, check them` : ''}</small></span></label>
      <button type="button" className="picker-forget" aria-label={`Remove ${f.name}`} disabled={pending || (locked && selection.includes(f.id))} onClick={() => forget(f)}>Remove</button>
    </div>)}
    {!files.length && <p className="picker-note">No worksheets yet. Upload your material on the Worksheets page.</p>}
    <Link className="picker-manage" href="/worksheets"><Upload size={13}/>Upload or manage worksheets</Link>
    <p className="picker-foot">{selection.length ? `${count} questions selected · enough for ${Math.floor(count / 20)} ${Math.floor(count / 20) === 1 ? 'round' : 'rounds'} of 20` : 'A round is 20 questions by default; you can change it in the marking plan.'}</p>
  </div>;
}
