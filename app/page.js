'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import AgentsPanel, { DEFAULT_ACTIVE, extraAgents, seatedAgents } from './agents';
import Composer from './composer';
import Sidebar from './sidebar';
import ProgressChart from './progress-chart';
import ReportCard, { Recommendation } from './report-card';
import WorksheetModal from './worksheet-modal';
import { modelMetrics, recommend, withAspects } from './model-metrics.mjs';
import { readApiResponse } from './api-response.mjs';

const STEPS = ['Setup', 'Running', 'Result'];
const PHASES = {
  benchmark: ['Part A', 'Answering 10 questions'],
  trading: ['Checking', 'Part A is being marked'],
  reveal: ['Part B', 'Answering 10 new questions'],
  settlement: ['Marking', 'Part B is being marked'],
  analysis: ['Wrapping up', 'Preparing results'],
};
const PHASE_ORDER = ['benchmark', 'trading', 'reveal', 'settlement', 'analysis'];

// Per-viewer conveniences only; the page works without storage.
function load(key, storage, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, storage, value) { try { storage.setItem(key, JSON.stringify(value)); } catch {} }

export default function ClassroomPage() {
  const [market, setMarket] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [active, setActive] = useState(DEFAULT_ACTIVE);
  const [selected, setSelected] = useState(null);
  const [minimum, setMinimum] = useState(80);
  const latest = useRef(0);
  const closeSheet = useCallback(() => setSelected(null), []);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      if (!response.ok) throw new Error('The backend is not running. Start FastAPI on port 8000.');
      const data = await response.json();
      if (request === latest.current) { setMarket(data); setError(e => e.startsWith('The backend') ? '' : e); }
    } catch (e) { if (request === latest.current) setError(e.message); }
  }, []);

  useEffect(() => {
    setRun(load('classRun', sessionStorage, null));
    setActive({ ...DEFAULT_ACTIVE, ...load('activeAgents', localStorage, {}) });
    refresh();
  }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, market?.running || busy ? 500 : 2000); return () => clearInterval(t); }, [market?.running, busy, refresh]);

  function toggle(key) {
    setActive(previous => { const next = { ...previous, [key]: !previous[key] }; store('activeAgents', localStorage, next); return next; });
  }

  async function start({ mode, rounds, plan }) {
    setBusy(true); setError('');
    try {
      if (plan) {
        // execution_spec is derived server-side; sending a stale one would override the edited fields.
        const { judge_model, saved_at, execution_spec, ...body } = plan;
        await readApiResponse(await fetch('/api/benchmark', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      }
      await readApiResponse(await fetch('/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, rounds }) }));
      const next = { startRound: market?.round || 0, rounds };
      setRun(next); store('classRun', sessionStorage, next);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function newClass() {
    if (!window.confirm('Start a new class? This clears the current worksheet and results.')) return;
    setBusy(true);
    try {
      await readApiResponse(await fetch('/api/reset', { method: 'POST' }));
      setRun(null); store('classRun', sessionStorage, null); setSelected(null);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const agents = seatedAgents(market?.workers || [], active);
  // Switched-off agents still run on the backend, but are left out of every comparison.
  const inClass = agents.filter(a => a.active);
  const classroom = agents.length ? [...agents, ...extraAgents(active)] : [];
  const countItems = market?.dataset?.benchmark_plan?.method === 'items';
  const step = market?.running || (busy && run) ? 1 : market?.round > 0 ? 2 : 0;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const rows = withAspects(modelMetrics(inClass, null, countItems));
  const pick = recommend(rows, minimum);
  const configured = market?.integrations?.configuration?.workers?.map(w => `${w.provider} · ${w.model}`) || [];
  const models = step > 0 && market?.mode === 'demo' ? agents.map(() => 'Simulated') : configured;
  const remaining = market?.dataset ? Math.floor(market.dataset.count / 20) - (market?.round || 0) : 10 - (market?.round || 0);

  const phase = market?.phase;
  const [phaseTitle, phaseDetail] = PHASES[phase] || ['Starting', 'Handing out questions'];
  const total = run?.rounds || 1;
  const quiz = Math.min(total, Math.max(1, (market?.round || 1) - (run?.startRound || 0)));
  const progress = Math.min(1, ((quiz - 1) + Math.max(0, PHASE_ORDER.indexOf(phase)) / PHASE_ORDER.length) / total);
  const state = step === 0 ? 'idle' : step === 2 ? 'done' : phase === 'benchmark' || phase === 'reveal' ? 'working' : 'waiting';

  const statuses = step === 1 ? Object.fromEntries(agents.map(a => [a.id, state === 'working' ? phaseTitle : a.score !== null ? `${a.score}% last part` : 'Waiting'])) : {};
  const scores = step === 2 ? Object.fromEntries(rows.map(r => [r.id, r.accuracy !== null ? `${r.accuracy.toFixed(0)}%` : '—'])) : {};
  const goal = market?.dataset?.benchmark_plan?.goal;

  return <div className="shell">
    <Sidebar>
      <button type="button" className="sidebar-button" onClick={newClass} disabled={!market || market.running || busy}><RotateCcw size={14}/>New class</button>
    </Sidebar>

    <div className="workspace">
      <main className={`stage stage-${step}`}>
        <header className="page-head">
          <div>
            <p className="eyebrow">{STEPS[step]}</p>
            <h1>{step === 0 ? 'Choose your agents and set the task' : step === 1 ? `Round ${quiz} of ${total} · ${phaseTitle}` : 'How the agents did'}</h1>
            <p>{step === 0 ? 'Switch on the agents you want to compare, describe the task below, and add a worksheet with questions and answers.'
              : step === 1 ? `${phaseDetail}. Every agent gets the same questions without the answer key.`
              : goal || (market?.mode === 'demo' ? 'Practice run on sample questions.' : 'Run on the default questions.')}</p>
            {step === 1 && <div className="progress" role="progressbar" aria-label="Class progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }}/></div>}
          </div>
          {step === 2 && <button type="button" className="quiet-button" disabled={busy || remaining < 1} onClick={() => start({ mode: market.mode, rounds: 1, plan: null })} title={remaining < 1 ? 'No unused questions left' : undefined}><Play size={14}/>One more round</button>}
        </header>

        {(error || market?.error) && <div className="notice" role="alert">{error || market.error}</div>}

        <div className="stage-grid">
          <div className="stage-left">
            <AgentsPanel agents={classroom} models={models} state={state} statuses={statuses} scores={scores} top={step === 2 ? pick?.worker.id : null}
              onToggle={step === 0 ? toggle : null} onOpen={step > 0 ? setSelected : null} compact={step > 0}/>
            {step === 2 && <Recommendation pick={pick} minimum={minimum} setMinimum={setMinimum} demo={market?.mode === 'demo'}/>}
          </div>
          {step === 1 && <div className="stage-right"><ProgressChart agents={inClass} countItems={countItems} live/></div>}
          {step === 2 && <div className="stage-right">
            <details className="drawer chart-drawer">
              <summary>Live chart<ChevronDown size={16} aria-hidden="true"/></summary>
              <ProgressChart agents={inClass} countItems={countItems} height={240}/>
            </details>
            <ReportCard rows={rows} winner={pick?.worker.id} onSelect={setSelected} countItems={countItems} plan={market?.dataset?.benchmark_plan} demo={market?.mode === 'demo'}/>
          </div>}
        </div>
      </main>
      <Composer market={market} step={step} busy={busy} refresh={refresh} onStart={start} onNewTask={newClass} onError={setError}/>
    </div>
    {selected && <WorksheetModal worker={agents.find(w => w.id === selected)} onClose={closeSheet}/>}
  </div>;
}
