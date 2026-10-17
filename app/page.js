'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bot, Check, ChevronDown,
  CircleHelp, FlaskConical, Globe2, Layers3, Loader2, Play, Radio, RotateCcw, Sparkles,
  Trophy, X, Zap
} from 'lucide-react';
import AgentsPanel, { DEFAULT_SEATS, seatedAgents } from './agents';
import BenchmarkPicker from './benchmark-picker';
import Composer from './composer';
import DatasetUpload from './dataset-upload';
import PerformanceChart from './performance-chart';
import ProgressChart from './progress-chart';
import ReportCard, { Recommendation } from './report-card';
import SolanaReceipt from './solana-receipt';
import WorksheetModal from './worksheet-modal';
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
const PHASE_ORDER = ['benchmark', 'trading', 'reveal', 'settlement', 'analysis'];

// Per-viewer conveniences only; the page works without storage.
function load(key, storage, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, storage, value) { try { storage.setItem(key, JSON.stringify(value)); } catch {} }

export default function ClassroomPage() {
  const [market, setMarket] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [seats, setSeats] = useState(DEFAULT_SEATS);
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
    setSeats(load('seats', localStorage, DEFAULT_SEATS));
    refresh();
  }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, market?.running || busy ? 500 : 2000); return () => clearInterval(t); }, [market?.running, busy, refresh]);

  function seat(index, key) {
    setSeats(previous => { const next = [...previous]; next[index] = key; store('seats', localStorage, next); return next; });
  }

  async function start({ mode, rounds, plan }) {
    setBusy(true); setError('');
    try {
      if (plan) {
        const { judge_model, saved_at, ...body } = plan;
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

  const agents = seatedAgents(market?.workers || [], seats);
  const countItems = market?.dataset?.benchmark_plan?.method === 'items';
  const step = market?.running || (busy && run) ? 1 : market?.round > 0 ? 2 : 0;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const rows = withAspects(modelMetrics(agents, null, countItems));
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
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark" aria-hidden="true"/>Agent Classroom</a>
      <p className="sidebar-label">Dashboard</p>
      <dl className="session">
        <div><dt>Worksheet</dt><dd>{market?.dataset ? `${market.dataset.name} · ${market.dataset.count} q` : 'Sample questions'}</dd></div>
        <div><dt>Run</dt><dd>{step === 0 ? '—' : market?.mode === 'live' ? 'Real models' : 'Practice (simulated)'}</dd></div>
        <div><dt>Quizzes done</dt><dd>{market?.round || 0}</dd></div>
      </dl>
      <button type="button" className="sidebar-button" onClick={newClass} disabled={!market || market.running || busy}><RotateCcw size={14}/>New class</button>
    </aside>

<div className='workspace'>
  <header className='topbar'>
    <div className='breadcrumb'>Workspace <span>/</span> <strong>{tab}</strong></div>
    <div className='topbar-right'>
      <span className='connection'><i className={market && !error ? 'status-dot' : 'status-dot offline'} />{market && !error ? 'Exchange connected' : 'Connecting'}</span>
      <span className='environment'><Globe2 size={13} /> SANDBOX</span>
    </div>
  </header>
  <main className={`stage stage-${step}`}>
    <header className='page-head'>
      <div>
        <p className='eyebrow'>{STEPS[step]}</p>
        <h1>{step === 0 ? 'Choose your agents and set the task' : step === 1 ? `Quiz ${quiz} of ${total} · ${phaseTitle}` : 'How the agents did'}</h1>
        <p>{step === 0 ? 'Pick who sits at each desk, describe the task below, and attach a worksheet with questions and answers.' : step === 1 ? `${phaseDetail}. Every agent gets the same questions without the answer key.` : goal || (market?.mode === 'demo' ? 'Practice run on sample questions.' : 'Run on the default questions.')}</p>
        {step === 1 && <div className='progress' role='progressbar' aria-label='Class progress' aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }} /></div>}
      </div>
      <div className='heading-actions'>
        <BenchmarkPicker market={market} mode={mode} refresh={refresh} onError={setError} />
        <select aria-label='Simulation mode' value={mode} disabled={running || !!market?.round} onChange={e => setMode(e.target.value)}>
          <option value='demo'>Demo simulation</option>
          <option value='live' disabled={!market?.live_available}>Live · AI models</option>
        </select>
        <select aria-label='Number of rounds' value={roundCount} disabled={running || busy} onChange={e => setRounds(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'round' : 'rounds'}</option>)}
        </select>
        <button type='button' className='primary-button' disabled={!market || running || busy || market.phase === 'interrupted'} onClick={() => action('/api/rounds', { mode, rounds: roundCount })}>
          {running || busy ? <Loader2 size={16} className='spin' /> : <Play size={15} fill='currentColor' />}
          {running ? 'Simulation in progress' : `Run ${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`}
        </button>
        {step === 2 && <button type='button' className='quiet-button' disabled={busy || remaining < 1} onClick={() => start({ mode: market.mode, rounds: 1, plan: null })} title={remaining < 1 ? 'No unused questions left' : undefined}><Play size={14} />One more quiz</button>}
      </div>
    </header>

        {(error || market?.error) && <div className="notice" role="alert">{error || market.error}</div>}

{(error || market?.error) && <div className='notice' role='alert'>{error || market.error}</div>}

{step === 0 || step === 1 || step === 2 ? (
  <div className='stage-grid'>
    <div className='stage-left'>
      <AgentsPanel agents={agents} models={models} state={state} statuses={statuses} scores={scores} top={step === 2 ? pick?.worker.id : null}
        seats={seats} onSeat={step === 0 ? seat : null} onOpen={step > 0 ? setSelected : null} compact={step > 0} />
      {step === 2 && <Recommendation pick={pick} minimum={minimum} setMinimum={setMinimum} demo={market?.mode === 'demo'} />}
    </div>
    {step === 1 && <div className='stage-right'><ProgressChart agents={agents} countItems={countItems} live /></div>}
    {step === 2 && <div className='stage-right'>
      <details className='drawer chart-drawer'>
        <summary>Live chart<ChevronDown size={16} aria-hidden='true' /></summary>
        <ProgressChart agents={agents} countItems={countItems} height={240} />
      </details>
      <ReportCard rows={rows} winner={pick?.worker.id} onSelect={setSelected} countItems={countItems} />
    </div>}
  </div>
) : null}

{tab === 'Overview' && <>
  <DatasetUpload dataset={market?.dataset} locked={running || !!market?.round} disabled={!market || busy} refresh={refresh} onNewSession={newSession} running={running} onDatasetUploaded={datasetUploaded} />
  <section className='metrics' aria-label='Market summary'>
    <Metric label='Trading volume' value={`${credits(market?.volume)} cr`} detail={`${market?.trades.length || 0} executed orders`} icon={<BarChart3 size={16} />} />
    <Metric label='Listed worker agents' value='03' detail={market?.dataset ? 'Custom benchmark · 3 models' : 'Math reasoning · 3 approaches'} icon={<Bot size={16} />} />
    <Metric label='Active AI traders' value='05' detail='Independent trading strategies' icon={<Activity size={16} />} />
    <Metric label={countItems ? 'Mean format pass rate' : rubricScoring ? 'Mean rubric pass rate' : 'Mean benchmark score'} value={market?.round ? `${avg.toFixed(1)}%` : '—'} detail={market?.round ? 'Latest batch · 10 problems per worker' : 'Awaiting the first benchmark'} icon={<FlaskConical size={16} />} />
  </section>
  <section className='panel briefing-panel' aria-label='Model comparison results'>
    <div className='briefing-heading'><div><h2>Model comparison</h2><p>{mode === 'demo' ? 'Simulated results · ' : `${market?.dataset?.name || 'GSM8K math'} results · `}{range === 'This round' ? 'Current round' : 'All rounds'} · matched batches only</p></div></div>
    <div className='briefing-grid'>{[['efficiency', 'Most token efficient'], ['speed', 'Fastest average'], ['overall', 'Overall best']].map(([key, title]) => {
      const leaders = metricLeaders(measured, key);
      return <div className='briefing-signal' key={key}><h3>{title}</h3><strong>{leaders.length ? leaders.map(w => w.name).join(' / ') : 'Awaiting measurements'}</strong><p>{leaders.length ? `${leaders.length > 1 ? 'Tied · ' : ''}${leaders[0][key].toFixed(2)} ${metricLabels[key].toLowerCase()}` : 'Run a new round to compare all three workers.'}</p></div>;
    })}</div>
    <div className='comparison-controls'><label>{countItems ? 'Minimum format pass rate' : rubricScoring ? 'Minimum rubric pass rate' : 'Minimum accuracy'} <select value={minimumAccuracy} onChange={e => setMinimumAccuracy(Number(e.target.value))}>{[50, 60, 70, 80, 90, 95, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></label><p role='status'>{recommended.length ? `${mode === 'demo' ? 'Simulated recommendation' : 'Fastest qualifying model'}: ${recommended.map(w => w.name).join(' / ')} · ${recommended[0].speed.toFixed(2)} s/question` : 'No measured model meets this pass-rate requirement.'}</p></div>
    <div className='table-scroll'><table><thead><tr><th>MODEL</th><th>{countItems ? `${outputUnit.toUpperCase()} / TOKENS` : rubricScoring ? 'PASSES / TOKENS' : 'CORRECT / TOKENS'}</th><th>EST. $ / 1,000 TOKENS</th><th>AVG TIME / QUESTION</th><th>{passLabel.toUpperCase()}</th><th>OVERALL</th></tr></thead><tbody>{measured.map(w => <tr key={w.id}><td><strong>{w.name}</strong></td><td>{w.efficiency === null ? '—' : `${w.efficiency.toFixed(2)} / 1k`}</td><td>{w.costPer1k === null ? '—' : `$${w.costPer1k.toFixed(4)}`}</td><td>{w.speed === null ? '—' : `${w.speed.toFixed(2)} s`}</td><td>{w.attempted ? `${w.correct}/${w.attempted} (${(100 * w.correct / w.attempted).toFixed(0)}%)` : '—'}</td><td>{w.overall === null ? '—' : `${w.overall.toFixed(1)} / 100`}</td></tr>)}</tbody></table></div>
    <p className='comparison-method'>USD cost uses configured blended token rates and excludes trader/analyst calls; missing prices show —. Tokens include provider-reported input and output, including reasoning where reported. Time is batch response time ÷ questions attempted, not individual question latency. Overall = geometric mean of {countItems ? `${outputUnit}/token and ${outputUnit}/second` : 'passing answers/token and passing answers/second'}, each relative to the best worker (equal weight). Zero counted outputs cannot win overall. {countItems && 'Item counts measure quantity; format pass rate does not establish relevance or originality.'} Scores are relative to this lineup and selected rounds.</p>
  </section>
  <section className='market-layout'>
    <div className='panel chart-panel'><div className='panel-heading'><div><h2>Model performance <span className='live-badge'><span className='status-dot'/> {running ? 'RUNNING' : 'READY'}</span></h2><p>Compare token efficiency, average solving time, and overall performance.</p></div><select aria-label='Chart range' value={range} onChange={e => setRange(e.target.value)}><option>All rounds</option><option>This round</option></select></div>
      <div className='comparison-controls'><label>Measure <select value={metric} onChange={e => setMetric(e.target.value)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className='chart-legend'>{measured.map(w => <span key={w.id}><i style={{ background: w.color }} />{w.name}<strong>{w[metric] === null ? '—' : w[metric].toFixed(2)}</strong></span>)}<span className='chart-unit'>{metric === 'speed' ? 'LOWER IS BETTER' : 'HIGHER IS BETTER'}</span></div>
      <PerformanceChart rows={metricRows} workers={workers} formatter={(v, name) => [`${Number(v).toFixed(2)} ${metric === 'speed' ? 's/question' : metric === 'efficiency' ? metricLabels.efficiency : '/100'}`, name]} />
      {!metricRows.some(row => workers.some(w => row[w.id] !== null)) && <div className='chart-empty'><Sparkles size={15} /> Run a round to measure model efficiency and speed.</div>}
      <div className='chart-footer'><span><Radio size={13} /> {running ? 'Updates after each benchmark batch' : 'One point per benchmark batch'}</span><span>{mode === 'demo' ? 'Simulated tokens and timing' : 'Provider tokens · measured wall time'}</span></div>
    </div>
    <div className='panel round-panel'><div className='panel-heading'><h2>Round progress</h2><span className='round-number'>ROUND {String(market?.round || 1).padStart(2, '0')}</span></div><p className='round-intro'>Each round has four steps.</p><div className='phases'>{phases.map((phase, i) => { const done = market?.phase === 'complete' || activePhase > i; return <div className={`phase ${activePhase === i ? 'current' : ''} ${done ? 'done' : ''}`} key={phase}><div className='phase-node'>{done ? <Check size={13} /> : activePhase === i ? <span className='pulse' /> : String(i + 1).padStart(2, '0')}</div><div><strong>{phaseLabels[i]}</strong><small>{['Workers solve 10 fresh problems', 'Five traders place their bets', 'A new benchmark tests predictions', 'Shares redeem. Profits realized.'][i]}</small></div>{activePhase === i && <Loader2 size={13} className='spin' />}</div>; })}</div><div className='settlement-note'><Zap size={14} /><p>Each share pays <strong>10 + next score</strong> credits at settlement.</p></div><button className='text-button' onClick={() => setHelp(true)}>How rounds work <ArrowRight size={14} /></button></div>
  </section>
</>}

{tab === 'Overview' && <section className='panel analyst-panel'><div className='panel-heading'><h2><Sparkles size={16} /> Market analyst</h2><span className='subtle'>{market?.phase === 'analysis' ? 'Writing round commentary…' : market?.analysis ? `Round ${market.analysis.round} · ${market.analysis.provider} / ${market.analysis.model}` : 'Post-settlement commentary'}</span></div><p>{market?.analysis?.summary || market?.analysis?.error || 'After each settlement, the analyst reviews benchmark changes, trader theses, and realized returns. Demo summaries are generated from a template; live summaries use your configured AI provider.'}</p></section>}
{(tab === 'Overview' || tab === 'Worker agents') && <section className='workers-section'><div className='section-heading'><h2>Meet the listed agents <span>3 ASSETS</span></h2><span className='subtle'>Intelligence, priced by the market.</span></div><div className='worker-grid'>{workers.map((w, i) => <button className='worker-card' onClick={() => setSelected(w.id)} key={w.id}><div className='worker-top'><span className={`bot-avatar bot-${i}`}><Bot size={23} /></span><div><h3>{w.name} <span>{w.symbol}</span></h3><p>{w.style}</p></div><ArrowUpRight size={16} className='worker-arrow' /></div><div className='model-label'>{w.provider ? `${w.provider} · ${w.model}` : 'Awaiting benchmark · no model results yet'}</div><div className='worker-price'>{credits(w.price)}<small>cr / share</small><span className={w.price >= w.previous ? 'positive' : 'negative'}>{w.price >= w.previous ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {w.previous ? `${((w.price - w.previous) / w.previous * 100).toFixed(1)}%` : '0%'}</span></div><div className='worker-bottom'><span>{passLabel} <strong style={{ color: w.color }}>{w.score === null ? 'Pending' : `${w.score}%`}</strong></span><span className='mini-bars'>{(w.scores.length ? w.scores.slice(-12) : Array.from({ length: 12 }, () => ({ score: 5 }))).map((s, j) => <i key={j} style={{ height: `${Math.max(3, s.score * .25)}px`, background: w.color, opacity: w.scores.length ? .45 + j * .04 : .15 }} />)}</span></div></button>)}</div></section>}

{(tab === 'Overview' || tab === 'AI traders' || tab === 'Activity') && <section className={`bottom-grid ${tab !== 'Overview' ? 'single-grid' : ''}`}>
  {tab !== 'Activity' && <div className='panel leaderboard'><div className='panel-heading'><h2><Trophy size={16} /> Trader leaderboard</h2><span className='subtle'>Started with 10,000 cr</span></div><div className='table-scroll'><table><thead><tr><th>RANK / TRADER</th><th>STRATEGY</th><th>PORTFOLIO</th><th>RETURN</th></tr></thead><tbody>{traders.map((t, i) => <tr key={t.id}><td><span className='rank'>{String(i + 1).padStart(2, '0')}</span><span className={`trader-avatar trader-${t.id}`}>{t.name[0]}</span><strong>{t.name}</strong>{i === 0 && market?.round > 0 && <span className='leader-tag'>LEAD</span>}</td><td>{t.strategy}</td><td className='mono'>{credits(t.equity)} <span className='subtle'>cr</span></td><td className={`mono ${t.equity >= 10000 ? 'positive' : 'negative'}`}>{t.equity >= 10000 ? '+' : ''}{((t.equity - 10000) / 100).toFixed(2)}%</td></tr>)}</tbody></table></div>{tab === 'AI traders' && <div className='theses'>{traders.map(t => <div key={t.id}><strong>{t.name}’s thesis</strong><p>{t.reason}</p><small>Cash {credits(t.cash)} cr · {Object.values(t.holdings).reduce((a, b) => a + b, 0)} shares held</small></div>)}</div>}<div className='table-footer'><span>Ranked by cash + marked-to-market positions</span><span>VIRTUAL P&L</span></div></div>}
  {tab !== 'AI traders' && <div className='panel activity-panel'><div className='panel-heading'><h2>Market activity</h2><span className='activity-live'><span className='status-dot'/> EVENT FEED</span></div><div className='activity-list'>{!market?.activity.length && <div className='empty-activity'><Radio size={25} /><h3>No activity yet</h3><p>Benchmarks, trades, and results will appear here when you run your first round.</p></div>}{market?.activity.slice(0, tab === 'Activity' ? 100 : 4).map(a => <div className='activity-item' key={a.id}><div className={`event-icon ${a.kind}`}>{a.kind === 'buy' ? <ArrowUpRight size={15} /> : a.kind === 'sell' ? <ArrowDownRight size={15} /> : a.kind === 'settlement' ? <Check size={15} /> : <FlaskConical size={15} />}</div><div><strong>{a.title}</strong><p>{a.detail}</p></div><time>{a.time}</time></div>)}</div>{tab === 'Overview' && <button className='activity-all' onClick={() => setTab('Activity')}>View all activity <ArrowRight size={13} /></button>}</div>}
</section>}
<details className='advanced-settings'><summary>Model settings & optional round receipt</summary><IntegrationPanel market={market} mode={mode} /><SolanaReceipt market={market} onBusy={setBusy} refresh={refresh} /></details>
<footer className='page-footer'><span><Layers3 size={13} /> AGENT EXCHANGE <span className='footer-divider'>/</span> An experiment in autonomous price discovery.</span><span>Virtual assets. Real curiosity.</span></footer>
      </main>
      <Composer market={market} step={step} busy={busy} refresh={refresh} onStart={start} onNewTask={newClass} onError={setError}/>
    </div>
{selected && <WorksheetModal worker={agents.find(w => w.id === selected)} onClose={closeSheet} />}
{(help || workerDetail) && <div className='modal-backdrop' onClick={() => { setHelp(false); setSelected(null); }}><section className='modal' role='dialog' aria-modal='true' aria-labelledby='dialog-title' onClick={e => e.stopPropagation()}><button type='button' className='modal-close' aria-label='Close dialog' onClick={() => { setHelp(false); setSelected(null); }} autoFocus><X size={20} /></button>{help ? <><h2 id='dialog-title'>How rounds work</h2><p>Three workers solve the same 10 problems. Five traders see their public scores and independently decide what to buy or sell. They never see the next answers.</p><p>Orders execute against a virtual market maker: each share moves the quote by 0.20 credits, and execution uses the average of the starting and ending quote. A trader can submit up to three orders of 1–30 shares each. No borrowing or short selling.</p><p>A fresh batch of 10 problems determines settlement. Each share pays <strong>10 + the worker’s accuracy percentage</strong>. An 80% score pays 90 credits. All positions close, and the next round begins with the resulting cash balances.</p><p className='modal-note'>Demo uses simulated agents with your uploaded questions or generated math. Live uses configured AI providers with your custom dataset or GSM8K, and incurs API charges. Start a new session to change modes. This is a local, single-process research prototype.</p></> : <><h2 id='dialog-title'>{workerDetail.name}’s benchmark</h2><p>{workerDetail.style} · Latest accuracy {workerDetail.score ?? '—'}{workerDetail.score !== null && '%'} · {credits(workerDetail.price)} cr / share</p>{workerDetail.diagnostics && <p>{workerDetail.diagnostics.repeat_agreement !== undefined && <>Exact repeat agreement: {workerDetail.diagnostics.repeat_agreement}% · </>}{workerDetail.diagnostics.numeric_valid_count !== undefined && <>Valid numeric answers: {workerDetail.diagnostics.numeric_valid_count}/{workerDetail.answers.length} · Mean absolute error: {workerDetail.diagnostics.mean_absolute_error?.toFixed(2) ?? '—'} · Signed grading bias: {workerDetail.diagnostics.grading_bias?.toFixed(2) ?? '—'}</>}</p>}{!workerDetail.answers.length && <p>Run a round to inspect this worker’s questions, submitted answers, and independently scored results.</p>}<div className='answer-list'>{workerDetail.answers.map((a, i) => <div key={i}><span className={a.correct ? 'positive' : 'negative'}>{a.correct ? '✓' : '×'} Problem {(i % 10) + 1}{a.attempt > 1 ? ` · Trial ${a.attempt}` : ''}</span><p>{a.question}</p><small>Submitted: {typeof a.answer === 'object' ? JSON.stringify(a.answer) : String(a.answer)} · Expected: {a.expected}</small>{a.evaluation_reason && <small className='evaluation-reason'>{a.evaluation_score !== undefined ? `Judge: ${a.evaluation_score}/100 · ` : ''}{a.evaluation_reason}</small>}</div>)}</div></>}</section></div>}
  </div>;
}
