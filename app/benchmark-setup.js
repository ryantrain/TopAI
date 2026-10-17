'use client';

import { useEffect, useState } from 'react';
import { readApiResponse } from './api-response.mjs';

// A method describes the shape of a correct answer. Gemini evaluates all of them except items.
const methods = { exact: 'Short answer / label', numeric: 'Numeric answer', json: 'Structured output', rubric: 'Open-ended response', items: 'Count distinct generated items' };
function editableSpec(plan) {
  if (plan?.execution_spec) return plan.execution_spec;
  if (!plan) return '';
  const { goal, evaluator, saved_at, ...protocol } = plan;
  return JSON.stringify(protocol, null, 2);
}

export default function BenchmarkSetup({ dataset, locked, refresh, uploadError, selectedFile, onSaved }) {
  const [plan, setPlan] = useState(() => ({ goal: dataset?.benchmark_plan?.goal || '', execution_spec: editableSpec(dataset?.benchmark_plan) }));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const savedPlan = JSON.stringify(dataset?.benchmark_plan || null);
  useEffect(() => {
    const saved = JSON.parse(savedPlan);
    if (saved) { setPlan({ goal: saved.goal, execution_spec: editableSpec(saved) }); setDirty(false); }
  }, [dataset?.digest, savedPlan]);
  useEffect(() => { setMessage(''); setError(''); }, [dataset?.digest]);
  function change(key, value) {
    setPlan(p => ({ ...p, [key]: value, ...(key === 'goal' ? { execution_spec: '' } : {}) }));
    setDirty(true); setMessage('');
  }
  let protocol = null;
  try {
    const parsed = JSON.parse(plan.execution_spec);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && ['procedure', 'selection', 'method'].every(key => parsed[key] === undefined || typeof parsed[key] === 'string')
      && ['repetitions', 'tolerance', 'pass_score'].every(key => parsed[key] === undefined || typeof parsed[key] === 'number')
      && (parsed.unsupported_requirements === undefined || (Array.isArray(parsed.unsupported_requirements) && parsed.unsupported_requirements.every(item => typeof item === 'string')))) protocol = parsed;
  } catch { /* Backend returns actionable JSON validation errors on save. */ }
  const repetitions = protocol?.repetitions ?? 1;

  async function submit(suggest = false) {
    if (!suggest && !dataset) {
      setError(uploadError ? `Dataset upload failed: ${uploadError}` : selectedFile ? `${selectedFile} has not been accepted as a dataset. Check the upload status below.` : 'Upload your task examples before saving the execution plan. Your draft will stay here.');
      return;
    }
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch(suggest ? '/api/benchmark/suggest' : '/api/benchmark', {
        method: suggest ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suggest ? { goal: plan.goal } : plan),
      });
      const data = await readApiResponse(response);
      setPlan({ goal: data.goal, execution_spec: editableSpec(data) });
      setDirty(suggest);
      if (suggest) setMessage('Execution plan drafted. Review how the tests will run, then save it for your dataset.');
      else { onSaved(data); setMessage('Execution plan saved. The backend will use it for the next run.'); await refresh(); }
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  return <div className="benchmark-setup">
    <h3>What do you need this model to do?</h3>
    <div className="benchmark-save-status" role="status">
      <strong>{dirty ? 'Unsaved changes' : dataset?.benchmark_plan ? 'Execution plan saved' : 'No execution plan saved'}</strong>
      {dataset?.benchmark_plan && <p>Saved for {dataset.name}{dataset.benchmark_plan.saved_at ? ` on ${new Date(dataset.benchmark_plan.saved_at).toLocaleString()}` : ''}. {dirty ? 'Save your changes to apply them.' : 'This plan controls the next run and remains saved after reloading.'}</p>}
    </div>
    <fieldset disabled={locked || pending}>
      <label>Your specific need<textarea maxLength={4000} value={plan.goal} onChange={e => change('goal', e.target.value)} placeholder="Find a consistent paper grader. Measure agreement with human marks and whether it grades too harshly."/></label>
      <button type="button" className="text-button" disabled={!plan.goal.trim()} onClick={() => submit(true)}>{pending ? 'Working…' : 'Build benchmark execution plan'}</button>
      <p>Your need becomes a plan for selecting examples, running repeated tests, and measuring results. Local Ollama drafts the plan; the backend validates and executes its settings, and Gemini decides whether each answer is correct. Upload real examples and reference answers to test against.</p>
      {protocol && <div className="execution-summary" aria-live="polite">
        <h4>How this benchmark will run</h4>
        <p>{protocol.procedure || 'Compare uploaded examples using the settings below.'}</p>
        <ul>
          <li>{protocol.selection === 'shuffled' ? 'Reproducibly shuffle' : 'Use uploaded order for'} 10 examples per stage, with a separate 10-example settlement batch.</li>
          <li>{repetitions} separate {repetitions === 1 ? 'call' : 'calls'} per model per stage. {repetitions > 1 ? 'Report exact output agreement across repeats.' : 'Each example is tested once.'}</li>
          <li>Score using {methods[protocol.method] || protocol.method}.{protocol.method === 'numeric' ? ` Allowed absolute error: ${protocol.tolerance}. Report mean absolute error and signed grading bias for valid numeric answers.` : protocol.method === 'rubric' ? ` Pass threshold: ${protocol.pass_score}/100. Gemini's time and tokens are excluded from worker metrics.` : protocol.method === 'items' ? ' Counts measure quantity, not relevance or originality.' : ''}</li>
          <li>{6 * repetitions} worker calls per round across three models, plus {protocol.method === 'items' ? 0 : 6 * repetitions} Gemini evaluator calls (one batch of 10 answers per model per stage). Repeats consume additional tokens and time.</li>
        </ul>
        {!!protocol.unsupported_requirements?.length && <p role="alert">This plan cannot be saved because these measurements need additional backend support: {protocol.unsupported_requirements.join('; ')}. Revise your need and rebuild the plan.</p>}
      </div>}
      <details className="benchmark-details" open={!protocol && !!plan.execution_spec}>
        <summary>Review or edit backend execution plan</summary>
        <p>This JSON string is the executable specification. Settings control the backend; procedure explains them. Model-facing task instructions and the extra criteria passed to Gemini are included separately inside the plan. Unknown operations and invalid settings are rejected.</p>
        <label>Benchmark execution plan<textarea rows={20} maxLength={40000} value={plan.execution_spec} onChange={e => change('execution_spec', e.target.value)} spellCheck={false} placeholder="Build a plan from your need, or enter a benchmark protocol as JSON."/></label>
      </details>
      <button type="button" className="primary-button" disabled={!plan.goal.trim() || !plan.execution_spec.trim() || !!protocol?.unsupported_requirements?.length} onClick={() => submit(false)}>{pending ? 'Working…' : 'Save benchmark execution plan'}</button>
    </fieldset>
    <p role="status">{message || (dirty ? 'Draft only. Save the execution plan to apply it.' : '')}</p>
    {locked && <p>The execution plan is fixed for this session. Start a new session to change it.</p>}
    {error && <p role="alert" className="dataset-error">{error}</p>}
  </div>;
}
