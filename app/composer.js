'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Loader2, Plus, SlidersHorizontal, Wand2, X } from 'lucide-react';
import { readApiResponse } from './api-response.mjs';

export const METHODS = {
  exact: 'Exact match',
  numeric: 'Number within tolerance',
  json: 'Structured JSON',
  rubric: 'Rubric judge',
  items: 'Count distinct items',
};
const BLANK_PLAN = { goal: '', method: 'exact', output_unit: 'ideas', instructions: '', rubric: '', tolerance: 0.000001, pass_score: 80 };

// Chat-style task box: describe the task, attach a worksheet with +, start with the arrow.
export default function Composer({ market, step, busy, refresh, onStart, onNewTask, onError }) {
  const dataset = market?.dataset;
  const [plan, setPlan] = useState(dataset?.benchmark_plan || BLANK_PLAN);
  const [details, setDetails] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState('demo');
  const [rounds, setRounds] = useState(1);
  const fileInput = useRef(null);
  const textarea = useRef(null);
  const maxRounds = dataset ? Math.floor(dataset.count / 20) : 10;
  const locked = step === 1;

  const savedPlan = JSON.stringify(dataset?.benchmark_plan || null);
  useEffect(() => { const saved = JSON.parse(savedPlan); if (saved) setPlan(saved); }, [savedPlan]);
  // Until a plan is drafted or saved, follow the worksheet's own answer type.
  useEffect(() => {
    if (dataset?.scoring && !dataset.benchmark_plan && !drafted) setPlan(p => ({ ...p, method: dataset.scoring, tolerance: dataset.tolerance ?? p.tolerance }));
  }, [dataset?.digest, dataset?.scoring, dataset?.tolerance, dataset?.benchmark_plan, drafted]);
  useEffect(() => { if (maxRounds > 0 && rounds > maxRounds) setRounds(maxRounds); }, [maxRounds, rounds]);
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }
  }, [plan.goal]);

  const change = (key, value) => setPlan(p => ({ ...p, [key]: value }));

  async function draft() {
    setDrafting(true); onError('');
    try {
      const data = await readApiResponse(await fetch('/api/benchmark/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: plan.goal }) }));
      setPlan({ ...BLANK_PLAN, ...data, goal: plan.goal }); setDrafted(true); setDetails(true);
    } catch (e) { onError(e.message); setDetails(true); }
    finally { setDrafting(false); }
  }

  async function upload(file) {
    if (!file) return;
    onError('');
    if (file.size > 2 * 1024 * 1024) { onError('Choose a file smaller than 2 MB.'); return; }
    setUploading(true);
    try {
      const scoring = plan.method === 'numeric' ? 'numeric' : 'exact';
      await readApiResponse(await fetch(`/api/dataset?filename=${encodeURIComponent(file.name)}&scoring=${scoring}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }));
      await refresh();
    } catch (e) { onError(e.message); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function removeDataset() {
    onError('');
    try { await readApiResponse(await fetch('/api/dataset', { method: 'DELETE' })); await refresh(); }
    catch (e) { onError(e.message); }
  }

  const liveBlocked = mode === 'live' && (!market?.live_available || !dataset);
  const tooSmall = dataset && maxRounds < 1;
  const canSend = step === 2 ? !!plan.goal.trim() && !busy
    : step === 0 && !!market && !busy && !uploading && !drafting && !liveBlocked && !tooSmall;

  function send() {
    if (!canSend) return;
    if (step === 2) { onNewTask(); return; }
    onStart({ mode, rounds, plan: dataset && plan.goal.trim() ? plan : null });
  }

  const note = step === 1 ? 'Agents are working. The task is locked until this class ends.'
    : step === 2 ? 'Send a new task to start a fresh class.'
    : tooSmall ? 'This worksheet needs at least 20 questions.'
    : mode === 'live' && !dataset ? 'Attach a worksheet to run real models.'
    : !dataset ? 'No worksheet attached: Practice uses sample math questions.'
    : mode === 'demo' ? 'Practice results are simulated.' : 'Questions are sent to the configured AI providers.';

  return <div className="composer-wrap">
    {details && step === 0 && <div className="composer-details">
      <div className="details-head"><strong>Marking details</strong><button type="button" className="icon-button" aria-label="Close marking details" onClick={() => setDetails(false)}><X size={15}/></button></div>
      {drafted && <p className="muted">Drafted from your task. Check it before you start.</p>}
      <div className="details-grid">
        <label>Instructions every agent gets<textarea rows={3} maxLength={8000} value={plan.instructions} onChange={e => change('instructions', e.target.value)} placeholder="Answer format and requirements. Never include the answer key."/></label>
        {plan.method === 'rubric' && <label>Rubric for the judge<textarea rows={3} maxLength={8000} value={plan.rubric} onChange={e => change('rubric', e.target.value)} placeholder="What a passing answer includes."/></label>}
        {plan.method === 'rubric' && <label>Passing score / 100<input type="number" min="1" max="100" value={plan.pass_score} onChange={e => change('pass_score', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
        {plan.method === 'items' && <label>What to count<input maxLength={40} value={plan.output_unit} onChange={e => change('output_unit', e.target.value)}/></label>}
      </div>
    </div>}

    {step === 0 && <div className="composer-options">
      {dataset
        ? <span className="chip file"><FileText size={13}/>{dataset.name}<small>{dataset.count} questions</small><button type="button" aria-label="Remove worksheet" onClick={removeDataset} disabled={busy}><X size={12}/></button></span>
        : uploading && <span className="chip"><Loader2 size={13} className="spin"/>Uploading…</span>}
      <label className="chip">Marking<select value={plan.method} onChange={e => change('method', e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {plan.method === 'numeric' && <label className="chip">±<input className="tolerance" type="number" min="0" step="any" value={plan.tolerance} onChange={e => change('tolerance', e.target.value === '' ? '' : Number(e.target.value))} aria-label="Allowed error"/></label>}
      <label className="chip">Run<select value={mode} onChange={e => setMode(e.target.value)}><option value="demo">Practice</option><option value="live" disabled={!market?.live_available}>Real models{market?.live_available ? '' : ' (no keys)'}</option></select></label>
      <label className="chip">Quizzes<select value={rounds} onChange={e => setRounds(Number(e.target.value))}>{Array.from({ length: Math.max(1, Math.min(10, maxRounds)) }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" className="chip action" onClick={() => setDetails(v => !v)} aria-expanded={details}><SlidersHorizontal size={13}/>Details</button>
      <button type="button" className="chip action" onClick={draft} disabled={!plan.goal.trim() || drafting}>{drafting ? <Loader2 size={13} className="spin"/> : <Wand2 size={13}/>}Suggest marking</button>
    </div>}

    <div className={`composer ${locked ? 'locked' : ''}`}>
      <textarea ref={textarea} rows={1} maxLength={4000} value={plan.goal} readOnly={locked} aria-label="Task for the agents"
        placeholder={step === 2 ? 'Describe a new task…' : 'Describe the task for your agents…'}
        onChange={e => change('goal', e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
      <label className={`round-button ${step !== 0 || uploading || busy ? 'disabled' : ''}`} title="Attach worksheet (CSV, JSON or JSONL)">
        <Plus size={17}/><span className="sr-only">Attach worksheet</span>
        <input ref={fileInput} type="file" accept=".csv,.json,.jsonl" disabled={step !== 0 || uploading || busy} onChange={e => upload(e.target.files?.[0])}/>
      </label>
      <button type="button" className="round-button send" onClick={send} disabled={!canSend} aria-label={step === 2 ? 'Start a new class' : 'Start class'}>
        {busy || locked ? <Loader2 size={17} className="spin"/> : <ArrowUp size={17}/>}
      </button>
    </div>
    <p className="composer-note">{note}</p>
  </div>;
}
