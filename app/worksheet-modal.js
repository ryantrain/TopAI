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
  const d = worker.diagnostics;
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={e => e.stopPropagation()} style={{ '--agent': worker.color }}>
      <button ref={closeButton} type="button" className="modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button>
      <h2 id="sheet-title">{worker.name}'s latest answers</h2>
      <p className="hint">{worker.model ? `${worker.model} · ` : ''}The most recent part, marked against your answer key.</p>
      {d && Object.keys(d).length > 0 && <dl className="diagnostics">
        {d.repeat_agreement !== undefined && <div><dt>Same answer on every repeat</dt><dd>{d.repeat_agreement}%</dd></div>}
        {d.numeric_valid_count !== undefined && <div><dt>Valid numbers</dt><dd>{d.numeric_valid_count}/{worker.answers.length}</dd></div>}
        {d.mean_absolute_error !== undefined && <div><dt>Average error</dt><dd>{d.mean_absolute_error === null ? '—' : d.mean_absolute_error.toFixed(3)}</dd></div>}
        {d.grading_bias !== undefined && <div><dt>Bias (answer − key)</dt><dd>{d.grading_bias === null ? '—' : d.grading_bias.toFixed(3)}</dd></div>}
      </dl>}
      {!worker.answers?.length && <p>Nothing marked yet.</p>}
      <ol className="sheet">{(worker.answers || []).map((a, i) => <li key={i} className={a.correct ? 'right' : 'wrong'}>
        <span className="mark" aria-label={a.correct ? 'Correct' : 'Incorrect'}>{a.correct ? '✓' : '✗'}</span>
        <div>{a.attempt > 1 && <span className="trial">Repeat {a.attempt}</span>}<p>{a.question}</p><small>Answer: <b>{text(a.answer)}</b> · Key: {text(a.expected)}</small>
          {a.evaluation_reason && <small className="reason">{a.evaluation_score !== undefined ? `Judge score ${a.evaluation_score}/100 · ` : ''}{a.evaluation_reason}</small>}</div>
      </li>)}</ol>
    </section>
  </div>;
}
