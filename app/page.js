'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bot, Check, ChevronDown, CircleHelp, FlaskConical, Globe2, Layers3, Loader2, Play, Radio, RotateCcw, Sparkles, Trophy, X, Zap } from 'lucide-react';
import AgentsPanel, { DEFAULT_ACTIVE, extraAgents, seatedAgents } from './agents';
import Composer from './composer';
import Sidebar from './sidebar';
import ProgressChart from './progress-chart';
import ReportCard, { Recommendation } from './report-card';
import WorksheetModal from './worksheet-modal';
import BenchmarkPicker from './benchmark-picker';
import DatasetUpload from './dataset-upload';
import PerformanceChart from './performance-chart';
import SolanaReceipt from './solana-receipt';
import { modelMetrics, metricLeaders, fastestQualified, recommend, withAspects } from './model-metrics.mjs';
import { readApiResponse } from './api-response.mjs';

const STEPS = ['Setup', 'Running', 'Result'];
const PHASES = {
  benchmark: ['Part A', 'Answering 10 questions'],
  trading: ['Checking', 'Part A is being marked'],
  reveal: ['Part B', 'Answering 10 new questions'],
  settlement: ['Marking', 'Part B is being marked'],
  analysis: ['Wrapping up', 'Preparing results'],
};
const workerColors = { atlas: '#2563eb', nova: '#7c3aed', orbit: '#b45309' };
const credits = (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v ?? 0);
const phases = ['benchmark', 'trading', 'settlement'];
const phaseLabels = ['Benchmark', 'Agents trade', 'Settlement'];
const navItems = [['Overview', BarChart3], ['Worker agents', Bot], ['AI traders', Trophy], ['Activity', Activity]];
const evidenceFor = (worker) => {
  const scores = (worker.scores || []).filter(score => score.stage === 'reveal').map(score => score.score);
  if (scores.length < 2) return { record: scores.length ? 'Building record' : 'No revealed rounds', movement: null };
  const movement = scores.at(-1) - scores.at(-2);
  const spread = Math.max(...scores) - Math.min(...scores);
  return { record: `${spread} pt range · ${spread <= 20 ? 'steady' : 'variable'}`, movement };
};
const PHASE_ORDER = ['benchmark', 'trading', 'reveal', 'settlement', 'analysis'];
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

  const latest = useRef(0);
  const marketRequest = useRef(0);
  const closeSheet = useCallback(() => setSelected(null), []);

  function datasetUploaded(dataset) {
    marketRequest.current += 1;
    setMarket(previous => ({ ...previous, dataset: { ...dataset, remaining_rounds: Math.floor(dataset.count / (dataset.batch_size || 20)) } }));
  }

  const refresh = useMemo(() => singleFlight(async () => {
    const request = ++marketRequest.current;
    try {
      const response = await fetch('/api/market', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Backend unavailable. Start FastAPI on port 8000.');
      const data = await response.json();
      if (request !== marketRequest.current) return;
      setMarket(data);
      if (data.round || data.running) setMode(data.mode);
      setError('');
    } catch (e) { if (request === marketRequest.current) setError(e.message || 'Could not connect to the exchange.'); }
  }), []);

  useEffect(() => { refresh(); }, []);
  useEffect(() => { const timer = setInterval(refresh, market?.running || busy ? 300 : 1200); return () => clearInterval(timer); }, [market?.running, busy]);
  useEffect(() => {
    setRun(load('classRun', sessionStorage, null));
  }, []);

  useEffect(() => {
    if (!help && !selected) return;
    const previous = document.activeElement;
    const handleKey = (e) => {
      if (e.key === 'Escape') { setHelp(false); setSelected(null); }
      if (e.key === 'Tab') {
        const items = document.querySelectorAll('.modal button, .modal a, .modal select');
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [help, selected]);

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
  const inClass = agents.filter(a => a.active);
  const classroom = agents.length ? [...agents, ...extraAgents(active)] : [];
  const countItems = market?.dataset?.benchmark_plan?.method === 'items';
  const outputUnit = market?.dataset?.benchmark_plan?.output_unit || 'ideas';
  const measured = modelMetrics(workers, range === 'This round' ? market?.round : null, countItems);
  const recommended = fastestQualified(measured, minimumAccuracy);
  const batchSize = market?.dataset?.batch_size || 20;
  const passLabel = countItems ? 'Format pass rate' : 'Accuracy';
  const metricLabels = { efficiency: countItems ? `${outputUnit} / 1,000 tokens` : 'Correct questions / 1,000 tokens', speed: 'Seconds / question', overall: 'Overall score / 100' };
  const metricRows = (workers[0]?.scores || []).filter(s => range !== 'This round' || s.round === market?.round).map(sample => {
    const batch = modelMetrics(workers.map(w => ({ ...w, scores: w.scores.filter(s => s.round === sample.round && s.stage === sample.stage) })), null, countItems);
    return { label: `R${sample.round} ${sample.stage}`, ...Object.fromEntries(batch.map(w => [w.id, w[metric]])) };
  });
  const traders = [...(market?.traders || [])].sort((a, b) => b.equity - a.equity);
  const avg = workers.length ? workers.reduce((n, w) => n + (w.score || 0), 0) / workers.length : 0;
  const activePhase = market?.phase === 'analysis' ? phases.length : phases.indexOf(market?.phase);
  const workerDetail = workers.find(w => w.id === selected);
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

        {tab === 'Overview' && <>
          <DatasetUpload dataset={market?.dataset} locked={running || !!market?.round} disabled={!market || busy} refresh={refresh} onNewSession={newSession} running={running} onDatasetUploaded={datasetUploaded}/>
          <section className="metrics" aria-label="Market summary">
            <Metric label="Trading volume" value={`${credits(market?.volume)} cr`} detail={`${market?.trades.length || 0} executed orders`} icon={<BarChart3 size={16}/>}/>
            <Metric label="Listed worker agents" value="03" detail={market?.dataset ? 'Custom benchmark · 3 models' : 'Math reasoning · 3 approaches'} icon={<Bot size={16}/>}/>
            <Metric label="Active AI traders" value="05" detail="Independent trading strategies" icon={<Activity size={16}/>}/>
            <Metric label={countItems ? "Mean format pass rate" : "Mean benchmark score"} value={market?.round ? `${avg.toFixed(1)}%` : '—'} detail={market?.round ? `Latest batch · ${batchSize} questions per agent` : 'Awaiting the first benchmark'} icon={<FlaskConical size={16}/>}/>
          </section>
          <section className="panel briefing-panel" aria-label="Model comparison results">
            <div className="briefing-heading"><div><h2>Model comparison</h2><p>{mode === 'demo' ? 'Simulated results · ' : `${market?.dataset?.name || 'GSM8K math'} results · `}{range === 'This round' ? 'Current round' : 'All rounds'} · matched batches only</p></div></div>
            <div className="briefing-grid">{[['efficiency', 'Most token efficient'], ['speed', 'Fastest average'], ['overall', 'Overall best']].map(([key, title]) => {
              const leaders = metricLeaders(measured, key);
              return <div className="briefing-signal" key={key}><h3>{title}</h3><strong>{leaders.length ? leaders.map(w => w.name).join(' / ') : 'Awaiting measurements'}</strong><p>{leaders.length ? `${leaders.length > 1 ? 'Tied · ' : ''}${leaders[0][key].toFixed(2)} ${metricLabels[key].toLowerCase()}` : 'Run a new round to compare all three workers.'}</p></div>;
            })}</div>
            <div className="comparison-controls"><label>{countItems ? 'Minimum format pass rate' : 'Minimum accuracy'} <select value={minimumAccuracy} onChange={e => setMinimumAccuracy(Number(e.target.value))}>{[50, 60, 70, 80, 90, 95, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></label><p role="status">{recommended.length ? `${mode === 'demo' ? 'Simulated recommendation' : 'Fastest qualifying model'}: ${recommended.map(w => w.name).join(' / ')} · ${recommended[0].speed.toFixed(2)} s/question` : 'No measured model meets this pass-rate requirement.'}</p></div>
            <div className="table-scroll"><table><thead><tr><th>MODEL</th><th>{countItems ? `${outputUnit.toUpperCase()} / TOKENS` : 'CORRECT / TOKENS'}</th><th>EST. $ / 1,000 TOKENS</th><th>AVG TIME / QUESTION</th><th>{passLabel.toUpperCase()}</th><th>OVERALL</th></tr></thead><tbody>{measured.map(w => <tr key={w.id}><td><strong>{w.name}</strong></td><td>{w.efficiency === null ? '—' : `${w.efficiency.toFixed(2)} / 1k`}</td><td>{w.costPer1k === null ? '—' : `$${w.costPer1k.toFixed(4)}`}</td><td>{w.speed === null ? '—' : `${w.speed.toFixed(2)} s`}</td><td>{w.attempted ? `${w.correct}/${w.attempted} (${(100 * w.correct / w.attempted).toFixed(0)}%)` : '—'}</td><td>{w.overall === null ? '—' : `${w.overall.toFixed(1)} / 100`}</td></tr>)}</tbody></table></div>
            <p className="comparison-method">USD cost uses configured blended token rates and covers worker calls only; the evaluator's own tokens are excluded and missing prices show —. Tokens include provider-reported input and output, including reasoning where reported. Time is batch response time ÷ questions attempted, not individual question latency. Overall = geometric mean of {countItems ? `${outputUnit}/token and ${outputUnit}/second` : 'passing answers/token and passing answers/second'}, each relative to the best worker (equal weight). Zero counted outputs cannot win overall. {countItems ? 'Item counts measure quantity; format pass rate does not establish relevance or originality.' : 'Correctness is Gemini’s verdict on each answer, not a verified result.'} Scores are relative to this lineup and selected rounds.</p>
          </section>
          <section className="market-layout">
            <div className="panel chart-panel"><div className="panel-heading"><div><h2>Model performance <span className="live-badge"><span className="status-dot"/> {running ? 'RUNNING' : 'READY'}</span></h2><p>Compare token efficiency, average solving time, and overall performance.</p></div><select aria-label="Chart range" value={range} onChange={e => setRange(e.target.value)}><option>All rounds</option><option>This round</option></select></div>
              <div className="comparison-controls"><label>Measure <select value={metric} onChange={e => setMetric(e.target.value)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
              <div className="chart-legend">{measured.map(w => <span key={w.id}><i style={{ background: w.color }}/>{w.name}<strong>{w[metric] === null ? '—' : w[metric].toFixed(2)}</strong></span>)}<span className="chart-unit">{metric === 'speed' ? 'LOWER IS BETTER' : 'HIGHER IS BETTER'}</span></div>
              <PerformanceChart rows={metricRows} workers={workers} loading={running} formatter={(v, name) => [`${Number(v).toFixed(2)} ${metric === 'speed' ? 's/question' : metric === 'efficiency' ? metricLabels.efficiency : '/100'}`, name]}/>
              {!running && !metricRows.some(row => workers.some(w => row[w.id] !== null)) && <div className="chart-empty"><Sparkles size={15}/> Run a round to measure model efficiency and speed.</div>}
              <div className="chart-footer"><span><Radio size={13}/> {running ? 'Updates after each benchmark batch' : 'One point per benchmark batch'}</span><span>{mode === 'demo' ? 'Simulated tokens and timing' : 'Provider tokens · measured wall time'}</span></div>
            </div>
            <div className="panel round-panel"><div className="panel-heading"><h2>Round progress</h2><span className="round-number">ROUND {String(market?.round || 1).padStart(2, '0')}</span></div><p className="round-intro">Each round has three steps.</p><div className="phases">{phases.map((phase, i) => { const done = market?.phase === 'complete' || activePhase > i; return <div className={`phase ${activePhase === i ? 'current' : ''} ${done ? 'done' : ''}`} key={phase}><div className="phase-node">{done ? <Check size={13}/> : activePhase === i ? <span className="pulse"/> : String(i + 1).padStart(2, '0')}</div><div><strong>{phaseLabels[i]}</strong><small>{[`Agents answer ${batchSize} fresh questions`, 'Five seeded strategies place their bets', 'Shares redeem. Profits realized.'][i]}</small></div>{activePhase === i && <Loader2 size={13} className="spin"/>}</div>; })}</div><div className="settlement-note"><Zap size={14}/><p>Each share pays <strong>10 + this round&rsquo;s score</strong> credits at settlement.</p></div><button className="text-button" onClick={() => setHelp(true)}>How rounds work <ArrowRight size={14}/></button></div>
          </section>
        </>}

        {tab === 'Overview' && <section className="panel analyst-panel"><div className="panel-heading"><h2><Sparkles size={16}/> Market analyst</h2><span className="subtle">{market?.phase === 'analysis' ? 'Writing round commentary…' : market?.analysis ? `Round ${market.analysis.round} · ${market.analysis.provider} / ${market.analysis.model}` : 'Post-settlement commentary'}</span></div><p>{market?.analysis?.summary || market?.analysis?.error || 'After each settlement, the analyst reviews benchmark changes, trader theses, and realized returns. Demo summaries are generated from a template; live summaries use your configured AI provider.'}</p></section>}
        {(tab === 'Overview' || tab === 'Worker agents') && <section className="workers-section"><div className="section-heading"><h2>Meet the listed agents <span>3 ASSETS</span></h2><span className="subtle">Intelligence, priced by the market.</span></div><div className="worker-grid">{workers.map((w, i) => <button className="worker-card" onClick={() => setSelected(w.id)} key={w.id}><div className="worker-top"><span className={`bot-avatar bot-${i}`}><Bot size={23}/></span><div><h3>{w.name} <span>{w.symbol}</span></h3><p>{running && w.status ? w.status : w.style}</p></div><ArrowUpRight size={16} className="worker-arrow"/></div><div className="model-label">{w.provider ? `${w.provider} · ${w.model}` : 'Awaiting benchmark · no model results yet'}</div><div className="worker-price">{credits(w.price)}<small>cr / share</small><span className={w.price >= w.previous ? 'positive' : 'negative'}>{w.price >= w.previous ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {w.previous ? `${((w.price - w.previous) / w.previous * 100).toFixed(1)}%` : '0%'}</span></div><div className="worker-bottom"><span>{passLabel} <strong style={{ color: w.color }}>{w.score === null ? 'Pending' : `${w.score}%`}</strong></span><span className="mini-bars">{(w.scores.length ? w.scores.slice(-12) : Array.from({length:12}, () => ({score:5}))).map((s, j) => <i key={j} style={{height:`${Math.max(3, s.score * .25)}px`,background:w.color,opacity:w.scores.length ? .45 + j*.04 : .15}}/>)}</span></div></button>)}</div></section>}
        {(error || market?.error) && <div className="notice" role="alert">{error || market.error}</div>}

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
      </main>
      <Composer market={market} step={step} busy={busy} refresh={refresh} onStart={start} onNewTask={newClass} onError={setError}/>
    </div>
    {selected && <WorksheetModal worker={agents.find(w => w.id === selected)} onClose={closeSheet}/>}
    {(help || workerDetail) && <div className="modal-backdrop" onClick={() => {setHelp(false);setSelected(null);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()}><button type="button" className="modal-close" aria-label="Close dialog" onClick={() => {setHelp(false);setSelected(null);}} autoFocus><X size={20}/></button>{help ? <><h2 id="dialog-title">How rounds work</h2><p>Three agents answer the same batch of questions. Demo simulates answers and scores; live runs use model judging against your reference answers. Five seeded strategies then react to the scores.</p><p>Orders execute against a virtual market maker: each share moves the quote by 0.20 credits, and execution uses the average of the starting and ending quote. A trader can submit up to three orders of 1–30 shares each. No borrowing or short selling.</p><p>Settlement uses that same batch: each share pays <strong>10 + the agent’s accuracy percentage</strong>, so an 80% score pays 90 credits. All positions close, and the next round draws the next unused batch. Because traders see the score they settle against, the market carries no forecasting risk.</p><p className="modal-note">Demo uses simulated agents with your uploaded questions or generated math. Live uses configured AI providers with your custom dataset or GSM8K, and incurs API charges. Start a new session to change modes. This is a local, single-process research prototype.</p></> : <><h2 id="dialog-title">{workerDetail.name}’s benchmark</h2><p>{workerDetail.style} · Latest accuracy {workerDetail.score ?? '—'}{workerDetail.score !== null && '%'} · {credits(workerDetail.price)} cr / share</p>{workerDetail.diagnostics && <p>{workerDetail.diagnostics.repeat_agreement !== undefined && <>Exact repeat agreement: {workerDetail.diagnostics.repeat_agreement}% · </>}{workerDetail.diagnostics.numeric_valid_count !== undefined && <>Valid numeric answers: {workerDetail.diagnostics.numeric_valid_count}/{workerDetail.answers.length} · Mean absolute error: {workerDetail.diagnostics.mean_absolute_error?.toFixed(2) ?? '—'} · Signed grading bias: {workerDetail.diagnostics.grading_bias?.toFixed(2) ?? '—'}</>}</p>}{!workerDetail.answers.length && <p>Run a round to inspect this worker’s questions, submitted answers, and independently scored results.</p>}<div className="answer-list">{workerDetail.answers.map((a, i) => <div key={i}><span className={a.correct ? 'positive' : 'negative'}>{a.correct ? '✓' : '×'} Question {(i % batchSize) + 1}{a.attempt > 1 ? ` · Trial ${a.attempt}` : ''}</span><p>{a.question}</p><small>Submitted: {typeof a.answer === 'object' ? JSON.stringify(a.answer) : String(a.answer)} · Expected: {a.expected}</small>{a.evaluation_reason && <small className="evaluation-reason">{a.evaluation_score !== undefined ? `Gemini: ${a.evaluation_score}/100 · ` : ''}{a.evaluation_reason}</small>}</div>)}</div></>}</section></div>}
  </div>;
}
