'use client';

import { useEffect, useState } from 'react';
import { readApiResponse } from './api-response.mjs';

const methods = { exact: 'Exact answer / label', numeric: 'Numeric agreement', json: 'Structured JSON equality', rubric: 'Local rubric judge (Ollama)', items: 'Count distinct generated items' };

export default function BenchmarkSetup({ dataset, locked, refresh, uploadError, selectedFile, onSaved }) {
  const [plan, setPlan] = useState(dataset?.benchmark_plan || {
    goal: '', method: dataset?.scoring || 'exact', output_unit: 'ideas', instructions: '', rubric: '', tolerance: dataset?.tolerance ?? 0.000001, pass_score: 80,
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const savedPlan = JSON.stringify(dataset?.benchmark_plan || null);
  useEffect(() => {
    const saved = JSON.parse(savedPlan);
    if (saved) { setPlan(saved); setDirty(false); }
    else setPlan(previous => previous.goal ? previous : { ...previous, method: dataset?.scoring || 'exact', tolerance: dataset?.tolerance ?? 0.000001 });
  }, [dataset?.digest, dataset?.scoring, dataset?.tolerance, savedPlan]);
  useEffect(() => {
    setMessage(''); setError('');
  }, [dataset?.digest]);
  function change(key, value) { setPlan(p => ({ ...p, [key]: value })); setDirty(true); setMessage(''); }

  async function submit(suggest = false) {
    if (!suggest && !dataset) {
      setError(uploadError ? `Dataset upload failed: ${uploadError}` : selectedFile ? `${selectedFile} has not been accepted as a dataset. Check the upload status below.` : 'Choose a dataset file below before saving benchmark criteria. Your draft will stay here while you upload.');
      return;
    }
    setPending(true); setError(''); setMessage('');
    try {
      const { judge_model, ...body } = plan;
      const response = await fetch(suggest ? '/api/benchmark/suggest' : '/api/benchmark', {
        method: suggest ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suggest ? { goal: plan.goal } : body),
      });
      const data = await readApiResponse(response);
      if (suggest) { setPlan(data); setDirty(true); setMessage('Task benchmark drafted. Review the instructions and scoring below; upload your examples before saving if needed.'); }
      else { setPlan(data); setDirty(false); onSaved(data); setMessage('Benchmark criteria saved for this dataset.'); await refresh(); }
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  return <div className="benchmark-setup">
    <h3>What do you need this model to do?</h3>
    <div className="benchmark-save-status" role="status">
      <strong>{dirty ? 'Unsaved changes' : dataset?.benchmark_plan ? 'Criteria saved' : 'Criteria not saved yet'}</strong>
      {dataset?.benchmark_plan && <p>Saved for {dataset.name}{dataset.benchmark_plan.saved_at ? ` on ${new Date(dataset.benchmark_plan.saved_at).toLocaleString()}` : ''}. {methods[dataset.benchmark_plan.method]}{dataset.benchmark_plan.method === 'items' ? ` · ${dataset.benchmark_plan.output_unit || 'ideas'} / 1,000 tokens` : ''}. {dirty ? 'Save your changes to apply them.' : 'These criteria will be used in the next run and remain saved after reloading.'}</p>}
    </div>
    <fieldset disabled={locked || pending}>
      <label>Your specific need<textarea maxLength={4000} value={plan.goal} onChange={e => change('goal', e.target.value)} placeholder="I want the best model for grading papers."/></label>
      <button type="button" className="text-button" disabled={!plan.goal.trim()} onClick={() => submit(true)}>{pending ? 'Working…' : 'Build benchmark from my request'}</button>
      <p>Describe the job in your own words. Paper-grading requests are parsed locally; other requests use local Ollama. Upload real task examples and reference answers, then review and save the generated benchmark.</p>
      <details className="benchmark-details" open={!!plan.goal}><summary>Review task instructions and scoring</summary><div className="benchmark-fields">
        <label>Evaluate using<select value={plan.method} onChange={e => change('method', e.target.value)}>{Object.entries(methods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {plan.method === 'items' && <label>Output items to count<input maxLength={40} value={plan.output_unit ?? 'ideas'} onChange={e => change('output_unit', e.target.value)} placeholder="ideas, suggestions, test cases"/></label>}
        {plan.method === 'numeric' && <label>Allowed absolute error<input type="number" min="0" step="any" value={plan.tolerance} onChange={e => change('tolerance', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
        {plan.method === 'rubric' && <label>Passing judge score / 100<input type="number" min="1" max="100" step="1" value={plan.pass_score} onChange={e => change('pass_score', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
      </div>
      <label>Shared task instructions<textarea maxLength={8000} value={plan.instructions} onChange={e => change('instructions', e.target.value)} placeholder="State the output format and task requirements. Do not include evaluation answer keys."/></label>
      {plan.method === 'rubric' && <label>Judge criteria<textarea maxLength={8000} value={plan.rubric} onChange={e => change('rubric', e.target.value)} placeholder="Define correctness, completeness, tone, and what constitutes a failure. The judge can compare against your reference answers."/></label>}
      </details>
      <button type="button" className="primary-button" disabled={!plan.goal.trim()} onClick={() => submit(false)}>{pending ? 'Working…' : 'Save benchmark criteria'}</button>
    </fieldset>
    {plan.method === 'items' ? <p>Efficiency = distinct {plan.output_unit || 'items'} generated ÷ total tokens × 1,000. Each response must be a JSON array of nonempty strings. Duplicates within a response count once after ignoring case and whitespace. This measures quantity, not relevance or originality. The format pass rate measures responses containing at least one item.</p> : plan.method === 'rubric' ? <p>Rubric scores are estimates from a local model. Calibrate them against human judgments. The comparison reports the fraction of responses passing your threshold; judge time and tokens are excluded from worker metrics.</p> : <p>Scoring runs directly in Python. JSON comparison ignores object key order but preserves array order and value types. Numeric comparison uses your allowed error.</p>}
    <p role="status">{message || (dirty ? 'Draft only. Upload your dataset and save the criteria to use this task benchmark.' : dataset?.benchmark_plan ? `Saved: ${dataset.benchmark_plan.goal} · ${methods[dataset.benchmark_plan.method]}` : 'Describe your task to build a benchmark for your own dataset.')}</p>
    {!dataset && <p>For paper grading, upload papers with assignment prompts and marking rubrics in question, and human-assigned marks in answer. The app tests grading agreement on those papers.</p>}
    {locked && <p>Criteria are fixed for this session. Start a new session to change them.</p>}
    {error && <p role="alert" className="dataset-error">{error}</p>}
  </div>;
}
