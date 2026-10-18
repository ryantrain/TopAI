'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Plus, SlidersHorizontal, Wand2, X } from 'lucide-react';
import BenchmarkPicker from './benchmark-picker';
import { readApiResponse } from './api-response.mjs';
import { uploadWorksheets } from './library-api.mjs';


export const METHODS = {
  exact: 'Exact match',
  numeric: 'Number within tolerance',
  json: 'Structured JSON',
  rubric: 'AI rubric judge',
  items: 'Count distinct items',
};
const BLANK_PLAN = { goal: '', method: 'exact', output_unit: 'ideas', instructions: '', rubric: '', tolerance: 0.000001, pass_score: 80, repetitions: 1 };

// Chat-style task box: describe the task, attach a worksheet with +, start with the arrow.
export default function Composer({ market, step, busy, refresh, onStart, onNewTask, onError }) {
  const dataset = market?.dataset;
  const [plan, setPlan] = useState(dataset?.benchmark_plan || BLANK_PLAN);
  const [details, setDetails] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [uploading, setUploading] = useState('');
  const [rounds, setRounds] = useState(1);
  const fileInput = useRef(null);
  const textarea = useRef(null);
  // Selected worksheets with fewer than 20 questions leave no dataset, which blocks runs.
  const selectedCount = market?.selection?.length ? market.selection_count || 0 : null;
  const maxRounds = dataset ? Math.floor(dataset.count / 20) : 0;
  const locked = step === 1;
  const evaluator = dataset?.benchmark_plan?.evaluator || market?.integrations?.evaluator;
  const judge = evaluator?.provider === 'gemini' ? 'Gemini judge' : 'Ollama fallback judge';
  const agentCount = market?.integrations?.configuration?.workers?.length || market?.workers?.length || 3;
  const runLabel = market?.live_available ? `${agentCount} API ${agentCount === 1 ? 'agent' : 'agents'}` : `${market?.workers?.length || 3} demo agents`;

  const savedPlan = JSON.stringify(dataset?.benchmark_plan || null);
  // Adopt a server-saved plan, but never overwrite a task the user has already typed.
  useEffect(() => { const saved = JSON.parse(savedPlan); if (saved) setPlan(p => ({ ...BLANK_PLAN, ...saved, goal: p.goal.trim() ? p.goal : saved.goal })); }, [savedPlan]);
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

  // Any worksheet (CSV/JSON as-is; PDFs, photos, Office files via the server's converter) joins the worksheet menu.
  async function upload(files) {
    if (!files.length) return;
    onError('');
    const failed = [];
    try {
      await uploadWorksheets(files, (i, u) => {
        if (u.status === 'reading') setUploading(files.length > 1 ? `Reading ${files[i].name} (${i + 1}/${files.length})…` : `Reading ${files[i].name}…`);
        if (u.status === 'failed') failed.push(`${files[i].name}: ${u.message}`);
      });
      await refresh();
    } catch (e) { failed.push(e.message); }
    if (failed.length) onError(failed.join(' '));
    setUploading('');
    if (fileInput.current) fileInput.current.value = '';
  }


  const tooSmall = (dataset || selectedCount !== null) && maxRounds < 1;
  const canSend = step === 2 ? !!plan.goal.trim() && !busy
    : step === 0 && !!plan.goal.trim() && !!market && !busy && !uploading && !drafting && !tooSmall;

  function send() {
    if (!canSend) return;
    if (step === 2) { onNewTask(); return; }
    onStart({ rounds, plan: dataset ? plan : null });
  }

  const note = step === 1 ? 'Agents are working. The task is locked until this class ends.'
    : step === 2 ? 'Send a new task to start a fresh class.'
    : uploading ? uploading
    : tooSmall ? `Selected worksheets have ${dataset?.count ?? selectedCount} questions; a quiz needs 20. Add or tick more worksheets.`
    : !dataset ? 'Add or select a worksheet with at least 20 questions before starting.'
    : market?.live_available
      ? `${agentCount} configured API ${agentCount === 1 ? 'agent is' : 'agents are'} ready. ${judge} compares answers with your key.`
      : `${market?.workers?.length || 3} simulated agents are ready because the API agent setup is incomplete. ${judge} compares answers with your key.`;

  return <div className="composer-wrap">
    {details && step === 0 && <div className="composer-details">
      <div className="details-head"><strong>Marking details</strong><button type="button" className="icon-button" aria-label="Close marking details" onClick={() => setDetails(false)}><X size={15}/></button></div>
      {drafted && <p className="muted">Drafted from your task. Check it before you start.</p>}
      {plan.unsupported_requirements?.length > 0 && <div className="unsupported"><strong>Not measured by this setup</strong><ul>{plan.unsupported_requirements.map(r => <li key={r}>{r}</li>)}</ul></div>}
      <div className="details-grid">
        <label>Instructions every agent gets<textarea rows={3} maxLength={8000} value={plan.instructions} onChange={e => change('instructions', e.target.value)} placeholder="Answer format and requirements. Never include the answer key."/></label>
        {plan.method === 'rubric' && <label>Rubric for the judge<textarea rows={3} maxLength={8000} value={plan.rubric} onChange={e => change('rubric', e.target.value)} placeholder="What a passing answer includes."/></label>}
        {plan.method === 'rubric' && <label>Passing score / 100<input type="number" min="1" max="100" value={plan.pass_score} onChange={e => change('pass_score', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
        {plan.method === 'items' && <label>What to count<input maxLength={40} value={plan.output_unit} onChange={e => change('output_unit', e.target.value)}/></label>}
      </div>
    </div>}

    {step === 0 && <div className="composer-options">
      <BenchmarkPicker market={market} disabled={busy || !!uploading} refresh={refresh} onError={onError}/>
      {uploading && <span className="chip"><Loader2 size={13} className="spin"/>Reading…</span>}
      <label className="chip">Marking<select value={plan.method} onChange={e => change('method', e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {plan.method === 'numeric' && <label className="chip">±<input className="tolerance" type="number" min="0" step="any" value={plan.tolerance} onChange={e => change('tolerance', e.target.value === '' ? '' : Number(e.target.value))} aria-label="Allowed error"/></label>}
      <span className="chip" title="The app uses configured API agents when their keys are ready, then falls back to simulated agents">{runLabel} · {judge}</span>
      <label className="chip" title="Ask each agent every question this many times to check consistency">Repeats<select value={plan.repetitions ?? 1} onChange={e => change('repetitions', Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
      <label className="chip">Quizzes<select value={rounds} onChange={e => setRounds(Number(e.target.value))}>{Array.from({ length: Math.max(1, Math.min(10, maxRounds)) }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" className="chip action" onClick={() => setDetails(v => !v)} aria-expanded={details}><SlidersHorizontal size={13}/>Details</button>
      <button type="button" className="chip action" onClick={draft} disabled={!plan.goal.trim() || drafting}>{drafting ? <Loader2 size={13} className="spin"/> : <Wand2 size={13}/>}Suggest marking</button>
    </div>}

    <div className={`composer ${locked ? 'locked' : ''}`}>
      <textarea ref={textarea} rows={1} maxLength={4000} value={plan.goal} readOnly={locked} aria-label="Task for the agents"
        placeholder={step === 2 ? 'Describe a new task…' : 'Describe the task for your agents…'}
        onChange={e => change('goal', e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
      <label className={`round-button ${step !== 0 || uploading || busy ? 'disabled' : ''}`} title="Add worksheets: CSV, JSON, PDF, photos, Word, Excel, PowerPoint or text">
        <Plus size={17}/><span className="sr-only">Add worksheets</span>
        <input ref={fileInput} type="file" multiple disabled={step !== 0 || !!uploading || busy} onChange={e => upload([...(e.target.files || [])])}/>
      </label>
      <button type="button" className="round-button send" onClick={send} disabled={!canSend} aria-label={step === 2 ? 'Start a new class' : 'Start class'}>
        {busy || locked ? <Loader2 size={17} className="spin"/> : <ArrowUp size={17}/>}
      </button>
    </div>
    <p className="composer-note">{note}</p>
  </div>;
}
