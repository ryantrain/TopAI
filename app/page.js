'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import AgentSetup from './agent-setup';
import AgentsPanel, { DEFAULT_ACTIVE, seatedAgents } from './agents';
import Composer from './composer';
import Sidebar from './sidebar';
import ProgressChart from './progress-chart';
import ReportCard, { Recommendation } from './report-card';
import WorksheetModal from './worksheet-modal';
import { modelMetrics, recommend, withAspects } from './model-metrics.mjs';
import { readApiResponse } from './api-response.mjs';

const STEPS = ['Setup', 'Running', 'Result'];
const PHASES = {
  benchmark: ['Quiz', 'Agents are answering the same 10 questions'],
};

// Per-viewer conveniences only; the page works without storage.
function load(key, storage, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, storage, value) { try { storage.setItem(key, JSON.stringify(value)); } catch {} }

export default function ClassroomPage() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [active, setActive] = useState(DEFAULT_ACTIVE);
  const [selected, setSelected] = useState(null);
  const [minimum, setMinimum] = useState(80);
  const [agentMode, setAgentMode] = useState(null);
  const latest = useRef(0);
  const closeSheet = useCallback(() => setSelected(null), []);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('The backend is not running. Start FastAPI on port 8000.');
      const data = await response.json();
      if (request === latest.current) { setSession(data); setError(e => e.startsWith('The backend') ? '' : e); }
    } catch (e) { if (request === latest.current) setError(e.message); }
  }, []);

  useEffect(() => {
    setRun(load('classRun', sessionStorage, null));
    setActive({ ...DEFAULT_ACTIVE, ...load('activeAgentsV2', localStorage, {}) });
    refresh();
  }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, session?.running || busy ? 500 : 2000); return () => clearInterval(t); }, [session?.running, busy, refresh]);

  function toggle(key) {
    setActive(previous => { const next = { ...previous, [key]: !previous[key] }; store('activeAgentsV2', localStorage, next); return next; });
  }

  async function start({ rounds, plan }) {
    setBusy(true); setError('');
    try {
      if (plan) {
        // execution_spec is derived server-side; sending a stale one would override the edited fields.
        const { judge_model, saved_at, execution_spec, ...body } = plan;
        await readApiResponse(await fetch('/api/benchmark', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      }
      const mode = step === 0 ? (agentMode === 'live' ? 'live' : 'demo') : session?.mode || 'demo';
      const agent_ids = agents.filter(agent => agent.active).map(agent => agent.id);
      await readApiResponse(await fetch('/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, rounds, agent_ids }) }));
      const next = { startRound: session?.round || 0, rounds, mode };
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
      setAgentMode(null);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const step = session?.running || (busy && run) ? 1 : session?.round > 0 ? 2 : 0;
  const visibleWorkers = step === 0 && agentMode === 'demo'
    ? (session?.demo_workers || session?.workers || []).slice(0, 3)
    : (session?.workers || []);
  const agents = seatedAgents(visibleWorkers, active);
  // Only switched-on agents are included in the run request and comparison.
  const inClass = agents.filter(a => a.active);
  const classroom = agents;
  const countItems = session?.dataset?.benchmark_plan?.method === 'items';
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const rows = withAspects(modelMetrics(inClass, null, countItems));
  const pick = recommend(rows, minimum);
  const liveRun = step === 0 ? agentMode === 'live' : session?.mode === 'live';
  const config = session?.configuration || session?.integrations?.configuration;
  const models = agents.map((agent, index) => liveRun
    ? [config?.workers?.[index]?.provider, config?.workers?.[index]?.model].filter(Boolean).join(' · ') || agent.model || 'API agent'
    : 'Simulated demo agent');
  const evaluator = session?.dataset?.benchmark_plan?.evaluator || session?.integrations?.evaluator;
  const judgeLabel = evaluator?.provider === 'gemini' ? 'Gemini API'
    : evaluator?.provider === 'openai' ? 'OpenAI API fallback' : 'Local Ollama fallback';
  const remaining = session?.dataset ? Math.floor(session.dataset.count / 10) - (session?.round || 0) : 10 - (session?.round || 0);

  const phase = session?.phase;
  const [phaseTitle, phaseDetail] = PHASES[phase] || ['Starting', 'Handing out questions'];
  const total = run?.rounds || 1;
  const quiz = Math.min(total, Math.max(1, (session?.round || 1) - (run?.startRound || 0)));
  const progress = Math.min(1, (quiz - 0.5) / total);
  const state = step === 0 ? 'idle' : step === 2 ? 'done' : phase === 'benchmark' || phase === 'reveal' ? 'working' : 'waiting';

  const statuses = step === 1 ? Object.fromEntries(agents.map(a => [a.id, state === 'working' ? phaseTitle : a.score !== null ? `${a.score}% last part` : 'Waiting'])) : {};
  const scores = step === 2 ? Object.fromEntries(rows.map(r => [r.id, r.accuracy !== null ? `${r.accuracy.toFixed(0)}%` : '—'])) : {};
  const goal = session?.dataset?.benchmark_plan?.goal;

  return <div className="shell">
    <Sidebar>
      <dl className="session">
        <div><dt>Worksheet</dt><dd>{session?.dataset ? `${session.dataset.name} · ${session.dataset.count} q` : 'None selected'}</dd></div>
        <div><dt>Run</dt><dd>{step === 0 ? agentMode === 'live' ? `${agents.length} API agents ready` : agentMode === 'demo' ? '3 demo agents' : 'Choose agents' : liveRun ? 'API agents' : 'Demo agents'}</dd></div>
        <div><dt>Judge</dt><dd>{judgeLabel}</dd></div>
        <div><dt>Quizzes done</dt><dd>{session?.round || 0}</dd></div>
      </dl>
      <button type="button" className="sidebar-button" onClick={newClass} disabled={!session || session.running || busy}><RotateCcw size={14}/>New class</button>
    </Sidebar>

    <div className="workspace">
      <main className={`stage stage-${step}`}>
        <header className="page-head">
          <div>
            <p className="eyebrow">{STEPS[step]}</p>
            <h1>{step === 0 ? agentMode ? 'Set the task' : 'Choose your agents' : step === 1 ? `Quiz ${quiz} of ${total} · ${phaseTitle}` : 'How the agents did'}</h1>
            <p>{step === 0 ? agentMode ? 'Switch on the agents you want to compare, describe the task below, and add a worksheet with questions and answers.' : 'Connect real model APIs, or continue immediately with the three local demo agents.'
              : step === 1 ? `${phaseDetail}. Every agent gets the same questions without the answer key.`
              : goal || `${liveRun ? 'API' : 'Simulated'} answers judged against your worksheet by ${judgeLabel}.`}</p>
            {step === 1 && <div className="progress" role="progressbar" aria-label="Class progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }}/></div>}
          </div>
          {step === 0 && agentMode && <button type="button" className="quiet-button" disabled={busy} onClick={() => setAgentMode(null)}>Change agents</button>}
          {step === 2 && <button type="button" className="quiet-button" disabled={busy || remaining < 1} onClick={() => start({ rounds: 1, plan: null })} title={remaining < 1 ? 'No unused questions left' : undefined}><Play size={14}/>One more quiz</button>}
        </header>

        {(error || session?.error) && <div className="notice" role="alert">{error || session.error}</div>}

        {step === 0 && !agentMode ? <AgentSetup configuration={config}
          onConfigured={async () => { setAgentMode('live'); await refresh(); }}
          onDemo={() => setAgentMode('demo')}/>
        : <div className="stage-grid">
          <div className="stage-left">
            <AgentsPanel agents={classroom} models={models} state={state} statuses={statuses} scores={scores} top={step === 2 ? pick?.worker.id : null}
              onToggle={step === 0 ? toggle : null} onOpen={step > 0 ? setSelected : null} compact={step > 0}/>
            {step === 2 && <Recommendation pick={pick} minimum={minimum} setMinimum={setMinimum}/>}
          </div>
          {step === 1 && <div className="stage-right"><ProgressChart agents={inClass} countItems={countItems} live/></div>}
          {step === 2 && <div className="stage-right">
            <details className="drawer chart-drawer" open>
              <summary>Chart<ChevronDown size={16} aria-hidden="true"/></summary>
              <ProgressChart agents={inClass} countItems={countItems} height={240}/>
            </details>
            <ReportCard taskMetric={session?.dataset?.benchmark_plan?.task_metric} rows={rows} winner={pick?.worker.id} onSelect={setSelected} countItems={countItems}/>
          </div>}
        </div>}
      </main>
      {(step > 0 || agentMode) && <Composer session={session} step={step} busy={busy} refresh={refresh} onStart={start} onNewTask={newClass} onError={setError}/>}
    </div>
    {selected && <WorksheetModal worker={agents.find(w => w.id === selected)} onClose={closeSheet}/>}
  </div>;
}
