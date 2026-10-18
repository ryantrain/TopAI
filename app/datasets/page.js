'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Download, Eye, FileUp, Loader2, Trash2, X } from 'lucide-react';
import Sidebar from '../sidebar';
import { fetchWorksheet, removeWorksheet, selectWorksheets, uploadWorksheets } from '../library-api.mjs';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.pptx,.xlsx,.csv,.json,.jsonl,.txt,.md';
const date = iso => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };

export default function DatasetsPage() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState('');
  const [preview, setPreview] = useState(null);
  const input = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('The backend is not running. Start FastAPI on port 8000.');
      setSession(await response.json());
      setError(e => e.startsWith('The backend') ? '' : e);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);

  useEffect(() => {
    if (!preview) return;
    const onKey = e => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview]);

  const files = session?.library || [];
  const selection = session?.selection || [];
  const count = session?.selection_count || 0;
  const locked = !!session?.running || !!session?.round;
  const uploading = uploads.some(u => u.status === 'reading');

  async function upload(list) {
    if (!list.length || uploading) return;
    setError('');
    setUploads(list.map(f => ({ name: f.name, status: 'queued' })));
    try {
      await uploadWorksheets(list, (i, update) => setUploads(u => u.map((row, j) => j === i ? { ...row, ...update } : row)));
    } catch (e) { setError(e.message); }
    await refresh();
    if (input.current) input.current.value = '';
  }

  async function act(id, fn) {
    setPending(id); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(e.message); }
    finally { setPending(''); }
  }
  const toggle = id => act(id, () => selectWorksheets(selection.includes(id) ? selection.filter(i => i !== id) : [...selection, id]));
  const remove = file => { if (window.confirm(`Remove ${file.name}? It will be deleted from your datasets.`)) act(file.id, () => removeWorksheet(file.id)); };
  async function open(file) {
    setPreview({ file, rows: null });
    try { const data = await fetchWorksheet(file.id); setPreview({ file, rows: data.examples || [], instructions: data.instructions }); }
    catch (e) { setPreview(null); setError(e.message); }
  }

  return <div className="shell">
    <Sidebar>
      <dl className="session">
        <div><dt>Datasets saved</dt><dd>{files.length}</dd></div>
        <div><dt>Used in next class</dt><dd>{selection.length ? `${selection.length} · ${count} questions` : 'None selected'}</dd></div>
      </dl>
    </Sidebar>
    <div className="workspace">
      <main className="stage datasets">
        <header className="page-head">
          <div>
            <p className="eyebrow">Datasets</p>
            <h1>Turn your material into a dataset</h1>
            <p>Upload worksheets, past papers or notes. Each file becomes a set of questions with answers that your agents can be tested on. Tick the datasets to use, then go to the classroom.</p>
          </div>
          <Link className="quiet-button" href="/">Go to classroom<ArrowRight size={14}/></Link>
        </header>

        {error && <div className="notice" role="alert">{error}</div>}

        <section className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); upload([...(e.dataTransfer.files || [])]); }}>
          <FileUp size={22}/>
          <div>
            <h2>Drop files here, or <label className="link-label">browse<input ref={input} type="file" multiple accept={ACCEPT} disabled={uploading} onChange={e => upload([...(e.target.files || [])])}/></label></h2>
            <p>PDF, photos (PNG, JPG, HEIC), Word, PowerPoint, Excel, CSV, JSON or plain text · up to 10 MB each. CSV and JSON files with question and answer columns are imported as they are; everything else is read by AI, which pulls out each question and its answer.</p>
          </div>
        </section>

        {uploads.length > 0 && <ul className="upload-list" aria-live="polite">
          {uploads.map((u, i) => <li key={i} className={u.status}>
            {u.status === 'reading' ? <Loader2 size={14} className="spin"/> : u.status === 'added' ? <Check size={14}/> : u.status === 'failed' ? <AlertTriangle size={14}/> : <span className="dot"/>}
            <strong>{u.name}</strong>
            <span>{u.status === 'queued' ? 'Waiting' : u.status === 'reading' ? 'Reading… this can take a minute for long PDFs' : u.status === 'added' ? `Added as “${u.entry.name}” · ${u.entry.count} questions${u.entry.model_answers ? ` · ${u.entry.model_answers} answers worked out by AI` : ''}` : u.message}</span>
          </li>)}
          {!uploading && <li className="upload-done"><button type="button" className="link-button" onClick={() => setUploads([])}>Clear</button></li>}
        </ul>}

        <section className="dataset-list" aria-labelledby="saved-title">
          <div className="section-row">
            <div><h2 id="saved-title">Your datasets</h2>
              <p>{selection.length ? `${count} questions selected · ${Math.floor(count / 10)} ${Math.floor(count / 10) === 1 ? 'quiz' : 'quizzes'} available${count < 10 ? ` · add ${10 - count} more questions to run` : ''}` : 'None selected: choose or upload at least 10 questions before starting.'}</p></div>
            {selection.length > 0 && !locked && <button type="button" className="link-button" onClick={() => act('all', () => selectWorksheets([]))}>Clear selection</button>}
          </div>
          {locked && <p className="muted">A class is in progress or has results, so the selection is fixed. Start a new class in the classroom to change it. You can still upload and preview.</p>}
          {!files.length
            ? <div className="empty-state">No datasets yet. Upload a file above to create your first one.</div>
            : <div className="table-wrap"><table>
              <thead><tr><th>Use</th><th>Dataset</th><th className="num">Questions</th><th>Answers</th><th>Added</th><th className="num">Actions</th></tr></thead>
              <tbody>{files.map(f => <tr key={f.id} className={selection.includes(f.id) ? 'top' : ''}>
                <td><input type="checkbox" aria-label={`Use ${f.name} in the next class`} checked={selection.includes(f.id)} disabled={locked || !!pending} onChange={() => toggle(f.id)}/></td>
                <td><div className="dataset-name"><strong>{f.name}</strong><small>{f.source !== f.name ? `${f.source} · ` : ''}{f.origin === 'converted' ? 'Read by AI' : 'Imported'}</small></div></td>
                <td className="num">{f.count}</td>
                <td>{f.scoring === 'numeric' ? 'Numbers' : 'Text'}{f.model_answers > 0 && <span className="flag" title="These answers were not in the file and were worked out by AI. Check them before relying on results."><AlertTriangle size={12}/>{f.model_answers} to check</span>}</td>
                <td>{date(f.created_at)}</td>
                <td className="num"><div className="row-actions">
                  <button type="button" className="icon-button" aria-label={`Preview ${f.name}`} title="Preview" onClick={() => open(f)}><Eye size={15}/></button>
                  <a className="icon-button" href={`/api/library/${f.id}`} download aria-label={`Download ${f.name} as JSON`} title="Download JSON"><Download size={15}/></a>
                  <button type="button" className="icon-button" aria-label={`Remove ${f.name}`} title="Remove" disabled={!!pending || (locked && selection.includes(f.id))} onClick={() => remove(f)}>{pending === f.id ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>}</button>
                </div></td>
              </tr>)}</tbody>
            </table></div>}
          <p className="fine-print">Each quiz gives the same 10 fresh questions to every selected agent. Ticking several datasets merges them into one question set. Only upload material you have permission to use; files that need reading are sent to Gemini.</p>
        </section>
      </main>
    </div>

    {preview && <div className="modal-backdrop" onClick={() => setPreview(null)}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={e => e.stopPropagation()} style={{ '--agent': 'var(--navy)' }}>
        <button type="button" className="modal-close" aria-label="Close" onClick={() => setPreview(null)} autoFocus><X size={18}/></button>
        <h2 id="preview-title">{preview.file.name}</h2>
        <p className="hint">{preview.file.count} questions{preview.file.model_answers ? ` · ${preview.file.model_answers} answers worked out by AI` : ''}</p>
        {preview.instructions && <p className="preview-instructions"><strong>Instructions for agents:</strong> {preview.instructions}</p>}
        {!preview.rows ? <p className="muted"><Loader2 size={14} className="spin"/> Loading…</p>
          : <ol className="sheet numbered">{preview.rows.map((r, i) => <li key={i}><span className="mark">{i + 1}</span><div><p>{r.question}</p><small>Answer: <b>{String(r.answer)}</b></small></div></li>)}</ol>}
      </section>
    </div>}
  </div>;
}
