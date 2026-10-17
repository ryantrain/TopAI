'use client';
import { useState } from 'react';

import BenchmarkSetup from './benchmark-setup';
import { readApiResponse } from './api-response.mjs';

export default function DatasetUpload({ dataset, locked, disabled, refresh, onNewSession, running, onDatasetUploaded }) {
  const [scoring, setScoring] = useState('exact');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);

  async function upload(file) {
    if (!file) return;
    setError('');
    setMessage('');
    if (file.size > 2 * 1024 * 1024) { setError('Choose a file smaller than 2 MB.'); return; }
    setPending(true);
    try {
      const response = await fetch(`/api/dataset?filename=${encodeURIComponent(file.name)}&scoring=${scoring}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      const data = await readApiResponse(response);
      onDatasetUploaded(data);
      await refresh();
      setMessage(`Uploaded ${data.name}: ${data.count} examples. ${data.benchmark_plan ? 'LaTeX integrals detected. A math judging plan is saved above; equivalent formulas are judged by local Ollama.' : 'Build and save your benchmark execution plan above.'}`);
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  async function remove() {
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/dataset', { method: 'DELETE' });
      await readApiResponse(response);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  return <section className="panel dataset-panel" aria-labelledby="dataset-title">
    <div><h2 id="dataset-title">Your niche. Your benchmark.</h2>
      <p>Compare models on examples you curate. Upload a CSV, JSON, or JSONL file with <code>question</code> and <code>answer</code> fields.</p></div>
    {locked && <div role="status"><p>{running ? 'A simulation is running. Wait for it to finish, then start a new session to upload data or save different criteria.' : 'This session already has benchmark results. Start a new session to unlock uploads and criteria. This clears the active market; completed-round archives are retained.'}</p><button type="button" className="text-button" disabled={running || disabled || pending} onClick={onNewSession}>New session to edit benchmark</button></div>}
    <BenchmarkSetup dataset={dataset} locked={locked || pending || disabled} refresh={refresh} uploadError={error} selectedFile={file?.name} onSaved={plan => onDatasetUploaded({ ...dataset, benchmark_plan: plan })}/>
    <div className="dataset-controls">
      <label>Fallback scoring <select value={scoring} onChange={e => setScoring(e.target.value)} disabled={locked || pending || disabled}>
        <option value="exact">Exact text match</option><option value="numeric">Numeric answer</option>
      </select></label>
      <label className="dataset-file">{pending ? 'Saving dataset…' : dataset ? 'Replace dataset' : 'Upload dataset'}
        <input aria-label="Upload custom benchmark dataset" type="file" accept=".csv,.json,.jsonl" disabled={locked || pending || disabled} onChange={e => { const selected = e.target.files?.[0]; if (selected) { setFile(selected); upload(selected); } }}/>
      </label>
      <a href="/benchmark-template.csv" download>Download CSV template</a>
      <a href="/grading-template.json" download>Download paper grading template</a>
      {dataset && <button type="button" className="text-button" disabled={locked || pending || disabled} onClick={remove}>Use default benchmark</button>}
    </div>
    {file && !message && <p role="status">{pending ? `Uploading ${file.name}…` : `Selected: ${file.name}`}</p>}
    {error && <p role="alert" className="dataset-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <p className="dataset-status" role="status">{dataset ? `${dataset.name} · ${dataset.count} examples · ${dataset.benchmark_plan ? `Saved ${dataset.benchmark_plan.method === 'items' ? 'item-count' : dataset.benchmark_plan.method} benchmark` : `${dataset.scoring === 'numeric' ? 'Numeric' : 'Exact text'} scoring`} · ${dataset.remaining_rounds} rounds remaining` : 'Default: GSM8K in live mode; generated math in demo mode.'}</p>
    <p>20–2,000 distinct examples, up to 2 MB. Each round uses 10 public questions and 10 unused holdout questions. Without a saved plan, exact scoring trims surrounding whitespace and numeric scoring allows an error of 0.000001. A saved execution plan overrides this fallback. For paper grading, choose Numeric answer and upload the JSON template: include your rubric and marked examples in instructions, papers in question, and human marks in answer. Build a plan above to set the allowed mark difference and repeated grading tests.</p>
    <p>{locked ? 'Start a new session to change datasets.' : 'Live runs send questions to the configured providers; choose Ollama for all roles to keep inference local. Only upload data you have permission to share. Demo runs simulate answers and do not establish model performance.'}</p>
  </section>;
}
