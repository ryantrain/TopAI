'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Plus } from 'lucide-react';
import CriteriaReview from './criteria-review';
import WorksheetMenu, { selectionSummary } from './benchmark-picker';
import { readApiResponse } from './api-response.mjs';

const BLANK_PLAN = { goal: '', method: 'exact', output_unit: 'ideas', instructions: '', rubric: '', tolerance: 0.000001, pass_score: 80, repetitions: 1, batch_size: 20 };
const post = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Chat-style task box. Flow: choose worksheets with +, type the task, press ↑ so Qwen drafts a
// marking plan (POST /api/benchmark/suggest), review and save it (PUT /api/benchmark), then ↑ starts the class.
export default function Composer({ market, step, busy, refresh, onStart, onNewTask, onError }) {
  const dataset = market?.dataset;
  const [plan, setPlan] = useState(BLANK_PLAN);
  const [review, setReview] = useState(null); // null | drafting | review | saving | saved
  const [draftError, setDraftError] = useState('');
  const [draftedGoal, setDraftedGoal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [rounds, setRounds] = useState(1);
  const textarea = useRef(null);
  const drafting = useRef(null);
  const selectedCount = market?.selection?.length ? market.selection_count || 0 : null;
  // Questions per round come from the plan being edited, else the saved one (backend default 20).
  const roundSize = plan.batch_size || dataset?.batch_size || 20;
  const maxRounds = dataset ? Math.floor(dataset.count / roundSize) : selectedCount ? Math.floor(selectedCount / roundSize) : 0;
  const locked = step === 1;
  // No run-type control: real models when the backend has API keys, otherwise a simulated practice run.
  const mode = market?.live_available ? 'live' : 'demo';
  const noWorksheet = !market?.selection?.length;
  const tooSmall = !noWorksheet && maxRounds < 1;

  useEffect(() => { if (maxRounds > 0 && rounds > maxRounds) setRounds(maxRounds); }, [maxRounds, rounds]);
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }
  }, [plan.goal]);
  // Changing worksheets clears the plan saved on the server, so it has to be saved again.
  useEffect(() => { setReview(r => r === 'saved' ? 'review' : r); }, [dataset?.digest]);
  // A new class (after a reset) starts without a plan.
  useEffect(() => { if (step === 0 && !market?.round && !dataset) setReview(r => r === 'saved' ? null : r); }, [step, market?.round, dataset]);

  const change = (key, value) => { setPlan(p => ({ ...p, [key]: value })); setReview(r => r === 'saved' ? 'review' : r); };

  async function draft() {
    setReview('drafting'); setDraftError(''); onError('');
    const goal = plan.goal.trim();
    const controller = new AbortController();
    drafting.current = controller;
    try {
      const data = await readApiResponse(await fetch('/api/benchmark/suggest', { ...post('POST', { goal }), signal: controller.signal }));
      const { execution_spec, ...drafted } = data;
      setPlan({ ...BLANK_PLAN, ...drafted, goal: plan.goal });
    } catch (e) {
      setDraftError(controller.signal.aborted ? 'skipped' : e.message);
      setPlan(p => ({ ...p, method: dataset?.scoring || p.method, tolerance: dataset?.tolerance ?? p.tolerance }));
    }
    if (drafting.current !== controller) return;
    drafting.current = null;
    setDraftedGoal(goal);
    setReview('review');
  }
  const skipDraft = () => drafting.current?.abort();

  async function save() {
    setReview('saving'); onError('');
    try {
      // execution_spec is derived server-side; sending a stale one would override the edited fields.
      const { judge_model, saved_at, execution_spec, ...body } = plan;
      const saved = await readApiResponse(await fetch('/api/benchmark', post('PUT', body)));
      setPlan(p => ({ ...p, judge_model: saved.judge_model }));
      await refresh();
      setReview('saved');
      return true;
    } catch (e) { onError(e.message); setReview('review'); return false; }
  }

  const missingRubric = plan.method === 'rubric' && !plan.rubric?.trim();
  const canSend = step === 2 ? !!plan.goal.trim() && !busy
    : step === 0 && !!market && !busy && !noWorksheet && !tooSmall && !!plan.goal.trim() && review !== 'drafting' && review !== 'saving' && !(review && missingRubric);

  async function send() {
    if (!canSend) return;
    if (step === 2) { onNewTask(); return; }
    if (!review) { draft(); return; }
    if (review === 'review' && !(await save())) return;
    onStart({ mode, rounds, plan: null });
  }

  const runText = mode === 'live' ? 'real models, uses API credits' : 'practice run with simulated answers (no API keys set)';
  const note = step === 1 ? 'Agents are working. The task is locked until this class ends.'
    : step === 2 ? 'Send a new task to start a fresh class.'
    : noWorksheet ? 'Press + to choose a worksheet.'
    : tooSmall ? `Selected worksheets have ${selectedCount} questions; a round needs ${roundSize}. Press + to tick more worksheets, or lower questions per round.`
    : review === 'drafting' ? 'Qwen is turning your task into a marking plan. This usually takes under a minute.'
    : review === 'review' || review === 'saving' ? (missingRubric ? 'Add judge criteria before starting.' : 'Check the plan, then save it. Pressing ↑ saves and starts the class.')
    : review === 'saved' ? `Criteria saved · ${selectionSummary(market)} · ${runText}. Press ↑ to start.`
    : `${selectionSummary(market)} · Describe the task, then press ↑ and Qwen will draft how answers are marked.`;

  return <div className="composer-wrap">
    {step === 0 && review === 'drafting' && <div className="criteria drafting" role="status"><Loader2 size={16} className="spin"/><div><strong>Writing the marking plan</strong><p className="muted">Qwen is reading your task{dataset ? ` and ${dataset.name}` : ''} to choose how answers are evaluated. This runs on your computer and usually takes under a minute.</p></div><button type="button" className="link-button" onClick={skipDraft}>Skip, I'll fill it in</button></div>}
    {step === 0 && review && review !== 'drafting' && <CriteriaReview plan={plan} change={change} rounds={rounds} setRounds={setRounds} maxRounds={maxRounds}
      state={review} draftError={draftError} stale={!!draftedGoal && plan.goal.trim() !== draftedGoal}
      onSave={save} onRedraft={draft}/>}

    <div className={`composer ${locked ? 'locked' : ''}`}>
      {pickerOpen && step === 0 && <WorksheetMenu market={market} refresh={refresh} onError={onError} onClose={closePicker}/>}
      <textarea ref={textarea} rows={1} maxLength={4000} value={plan.goal} readOnly={locked} aria-label="Task for the agents"
        placeholder={step === 2 ? 'Describe a new task…' : 'Describe the task for your agents…'}
        onChange={e => setPlan(p => ({ ...p, goal: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
      <button type="button" className="round-button" data-picker-trigger aria-haspopup="true" aria-expanded={pickerOpen} aria-label="Choose worksheets" title="Choose worksheets"
        disabled={step !== 0 || busy || !market || review === 'drafting' || review === 'saving'} onClick={() => setPickerOpen(o => !o)}><Plus size={17}/></button>
      <button type="button" className="round-button send" onClick={send} disabled={!canSend}
        aria-label={step === 2 ? 'Start a new class' : !review ? 'Draft the marking plan' : review === 'saved' ? 'Start class' : 'Save criteria and start class'}>
        {busy || locked || review === 'drafting' || review === 'saving' ? <Loader2 size={17} className="spin"/> : <ArrowUp size={17}/>}
      </button>
    </div>
    <p className="composer-note">{note}</p>
  </div>;
}
