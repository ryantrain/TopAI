'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const text = v => typeof v === 'object' ? JSON.stringify(v) : String(v);

// The latest marked worksheet for one student.
export default function WorksheetModal({ worker, onClose }) {
  const closeButton = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);
  if (!worker) return null;
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={e => e.stopPropagation()} style={{ '--agent': worker.color }}>
      <button ref={closeButton} type="button" className="modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button>
      <h2 id="sheet-title">{worker.name}'s latest answers</h2>
      <p className="hint">{worker.model ? `${worker.model} · ` : ''}The most recent 10 questions, marked against your answer key.</p>
      {!worker.answers?.length && <p>Nothing marked yet.</p>}
      <ol className="sheet">{(worker.answers || []).map((a, i) => <li key={i} className={a.correct ? 'right' : 'wrong'}>
        <span className="mark" aria-label={a.correct ? 'Correct' : 'Incorrect'}>{a.correct ? '✓' : '✗'}</span>
        <div><p>{a.question}</p><small>Answer: <b>{text(a.answer)}</b> · Key: {text(a.expected)}</small>
          {a.evaluation_reason && <small className="reason">{a.evaluation_score !== undefined ? `Judge ${a.evaluation_score}/100 · ` : ''}{a.evaluation_reason}</small>}</div>
      </li>)}</ol>
    </section>
  </div>;
}
