'use client';

import { useEffect, useRef, useState } from 'react';
import { modelMetrics, metricLeaders, fastestQualified } from './model-metrics.mjs';
import BenchmarkPicker from './benchmark-picker';
import DatasetUpload from './dataset-upload';
import PerformanceChart from './performance-chart';
import SolanaReceipt from './solana-receipt';
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bot, Check, ChevronDown, CircleHelp, FlaskConical, Globe2, Layers3, Loader2, Play, Radio, RotateCcw, Sparkles, Trophy, X, Zap } from 'lucide-react';

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

export default function Exchange() {
  const [market, setMarket] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');
  const [mode, setMode] = useState('demo');
  const [rounds, setRounds] = useState(1);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [help, setHelp] = useState(false);
  const [metric, setMetric] = useState('efficiency');
  const [minimumAccuracy, setMinimumAccuracy] = useState(90);
  const [range, setRange] = useState('All rounds');

  const marketRequest = useRef(0);
  function datasetUploaded(dataset) {
    marketRequest.current += 1;
    setMarket(previous => ({ ...previous, dataset: { ...dataset, remaining_rounds: Math.floor(dataset.count / (dataset.batch_size || 20)) } }));
  }

  async function refresh() {
    const request = ++marketRequest.current;
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      if (!response.ok) throw new Error('Backend unavailable. Start FastAPI on port 8000.');
      const data = await response.json();
      if (request !== marketRequest.current) return;
      setMarket(data);
      if (data.round || data.running) setMode(data.mode);
      setError('');
    } catch (e) { if (request === marketRequest.current) setError(e.message || 'Could not connect to the exchange.'); }
  }
  useEffect(() => { refresh(); }, []);
  // Poll quickly during a round so each executed order reaches the chart promptly.
  useEffect(() => { const timer = setInterval(refresh, market?.running || busy ? 300 : 1200); return () => clearInterval(timer); }, [market?.running, busy]);
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

  async function action(path, body) {
    setBusy(true);
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || 'Request failed'); }
      setSelected(null);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function newSession() {
    if (window.confirm('Start a new session? This clears the active market. Completed-round archives are retained.')) action('/api/reset');
  }

  const running = market?.running;
  const roundCount = rounds;
  const workers = market?.workers || [];
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
  return <div className="exchange">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Agent Exchange home"><span className="brand-icon"><Layers3 size={22}/></span><span>agent<span className="brand-light">exchange</span><small>THE INTELLIGENCE MARKET</small></span></a>
      <div className="workspace"><span className="workspace-icon">A</span><div>Research workspace<small>Virtual trading environment</small></div><ChevronDown size={14}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Primary workspace views">{navItems.map(([name, Icon]) => <button type="button" key={name} onClick={() => setTab(name)} aria-current={tab === name ? 'page' : undefined} className={tab === name ? 'nav-item active' : 'nav-item'}><Icon size={18}/>{name}{name === 'Worker agents' && <span className="nav-count">3</span>}{name === 'AI traders' && <span className="nav-count">5</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sandbox"><FlaskConical size={19}/><strong>A market for intelligence.</strong><p>Real benchmarks.<br/>Autonomous decisions.<br/>A new way to value AI.</p><span>100% virtual credits <ArrowUpRight size={13}/></span></div><button className="help-link" onClick={() => setHelp(true)}><CircleHelp size={17}/> How the exchange works <ArrowUpRight size={14}/></button><div className="profile"><div className="avatar">R</div><div>Research session<small>Local workspace</small></div><span className="status-dot"/></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{tab}</strong></div><div className="topbar-right"><span className="connection"><i className={market && !error ? 'status-dot' : 'status-dot offline'}/>{market && !error ? 'Exchange connected' : 'Connecting'}</span><span className="environment"><Globe2 size={13}/> SANDBOX</span></div></header>
      <nav className="mobile-nav" aria-label="Primary workspace views">{navItems.map(([name, Icon]) => <button type="button" key={name} onClick={() => setTab(name)} aria-current={tab === name ? 'page' : undefined} className={tab === name ? 'active' : ''}><Icon size={16}/><span>{name}</span></button>)}</nav>
      <main>
        <div className="page-heading"><div><h1>{tab === 'Overview' ? 'Intelligence has a market.' : tab}</h1><p>{tab === 'Overview' ? 'Watch AI agents put their predictions—and their credits—to the test.' : tab === 'Worker agents' ? 'The intelligence behind the assets. Inspect benchmark scores and answers.' : tab === 'AI traders' ? 'Five independent strategies. One shared market.' : 'Every benchmark, decision, and settlement, as it happens.'}</p></div><div className="heading-actions"><BenchmarkPicker market={market} mode={mode} refresh={refresh} onError={setError}/><select aria-label="Simulation mode" value={mode} disabled={running || !!market?.round} onChange={e => setMode(e.target.value)}><option value="demo">Demo simulation</option><option value="live" disabled={!market?.live_available}>Live · AI models</option></select><select aria-label="Number of rounds" value={roundCount} disabled={running || busy} onChange={e => setRounds(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'round' : 'rounds'}</option>)}</select><button type="button" className="primary-button" disabled={!market || running || busy || market.phase === 'interrupted'} onClick={() => action('/api/rounds', { mode, rounds: roundCount })}>{running || busy ? <Loader2 size={16} className="spin"/> : <Play size={15} fill="currentColor"/>}{running ? 'Simulation in progress' : `Run ${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`}</button></div></div>

        {(error || market?.error) && <div className="error-banner" role="alert">{error || market.error}</div>}
        <div className="session-strip"><span><span className="mode-dot"/><span>{mode === 'demo' ? 'Demo market' : 'Live market'}</span><span className="strip-divider"/><span>{mode === 'demo' ? 'Simulated agents · virtual credits' : `AI providers · ${market?.dataset?.name || 'GSM8K benchmarks'}`}</span></span><button disabled={running || busy || !market} onClick={newSession}><RotateCcw size={12}/> New session</button></div>


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
        {(tab === 'Overview' || tab === 'Worker agents') && <section className="workers-section"><div className="section-heading"><h2>Meet the listed agents <span>3 ASSETS</span></h2><span className="subtle">Intelligence, priced by the market.</span></div><div className="worker-grid">{workers.map((w, i) => <button className="worker-card" onClick={() => setSelected(w.id)} key={w.id}><div className="worker-top"><span className={`bot-avatar bot-${i}`}><Bot size={23}/></span><div><h3>{w.name} <span>{w.symbol}</span></h3><p>{w.style}</p></div><ArrowUpRight size={16} className="worker-arrow"/></div><div className="model-label">{w.provider ? `${w.provider} · ${w.model}` : 'Awaiting benchmark · no model results yet'}</div><div className="worker-price">{credits(w.price)}<small>cr / share</small><span className={w.price >= w.previous ? 'positive' : 'negative'}>{w.price >= w.previous ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {w.previous ? `${((w.price - w.previous) / w.previous * 100).toFixed(1)}%` : '0%'}</span></div><div className="worker-bottom"><span>{passLabel} <strong style={{ color: w.color }}>{w.score === null ? 'Pending' : `${w.score}%`}</strong></span><span className="mini-bars">{(w.scores.length ? w.scores.slice(-12) : Array.from({length:12}, () => ({score:5}))).map((s, j) => <i key={j} style={{height:`${Math.max(3, s.score * .25)}px`,background:w.color,opacity:w.scores.length ? .45 + j*.04 : .15}}/>)}</span></div></button>)}</div></section>}

        {(tab === 'Overview' || tab === 'AI traders' || tab === 'Activity') && <section className={`bottom-grid ${tab !== 'Overview' ? 'single-grid' : ''}`}>
          {tab !== 'Activity' && <div className="panel leaderboard"><div className="panel-heading"><h2><Trophy size={16}/> Trader leaderboard</h2><span className="subtle">Started with 10,000 cr</span></div><div className="table-scroll"><table><thead><tr><th>RANK / TRADER</th><th>STRATEGY</th><th>PORTFOLIO</th><th>RETURN</th></tr></thead><tbody>{traders.map((t, i) => <tr key={t.id}><td><span className="rank">{String(i+1).padStart(2,'0')}</span><span className={`trader-avatar trader-${t.id}`}>{t.name[0]}</span><strong>{t.name}</strong>{i === 0 && market?.round > 0 && <span className="leader-tag">LEAD</span>}</td><td>{t.strategy}</td><td className="mono">{credits(t.equity)} <span className="subtle">cr</span></td><td className={`mono ${t.equity >= 10000 ? 'positive' : 'negative'}`}>{t.equity >= 10000 ? '+' : ''}{((t.equity - 10000)/100).toFixed(2)}%</td></tr>)}</tbody></table></div>{tab === 'AI traders' && <div className="theses">{traders.map(t => <div key={t.id}><strong>{t.name}’s thesis</strong><p>{t.reason}</p><small>Cash {credits(t.cash)} cr · {Object.values(t.holdings).reduce((a,b)=>a+b,0)} shares held</small></div>)}</div>}<div className="table-footer"><span>Ranked by cash + marked-to-market positions</span><span>VIRTUAL P&L</span></div></div>}
          {tab !== 'AI traders' && <div className="panel activity-panel"><div className="panel-heading"><h2>Market activity</h2><span className="activity-live"><span className="status-dot"/> EVENT FEED</span></div><div className="activity-list">{!market?.activity.length && <div className="empty-activity"><Radio size={25}/><h3>No activity yet</h3><p>Benchmarks, trades, and results will appear here when you run your first round.</p></div>}{market?.activity.slice(0, tab === 'Activity' ? 100 : 4).map(a => <div className="activity-item" key={a.id}><div className={`event-icon ${a.kind}`}>{a.kind === 'buy' ? <ArrowUpRight size={15}/> : a.kind === 'sell' ? <ArrowDownRight size={15}/> : a.kind === 'settlement' ? <Check size={15}/> : <FlaskConical size={15}/>}</div><div><strong>{a.title}</strong><p>{a.detail}</p></div><time>{a.time}</time></div>)}</div>{tab === 'Overview' && <button className="activity-all" onClick={() => setTab('Activity')}>View all activity <ArrowRight size={13}/></button>}</div>}
        </section>}
        <details className="advanced-settings"><summary>Model settings & optional round receipt</summary><IntegrationPanel market={market} mode={mode}/><SolanaReceipt market={market} onBusy={setBusy} refresh={refresh}/></details>
        <footer className="page-footer"><span><Layers3 size={13}/> AGENT EXCHANGE <span className="footer-divider">/</span> An experiment in autonomous price discovery.</span><span>Virtual assets. Real curiosity.</span></footer>
      </main>
    </div>
    {(help || workerDetail) && <div className="modal-backdrop" onClick={() => {setHelp(false);setSelected(null);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()}><button type="button" className="modal-close" aria-label="Close dialog" onClick={() => {setHelp(false);setSelected(null);}} autoFocus><X size={20}/></button>{help ? <><h2 id="dialog-title">How rounds work</h2><p>Three agents answer the same batch of questions, and Gemini grades every answer against your reference answers. Five seeded strategies then react to the scores.</p><p>Orders execute against a virtual market maker: each share moves the quote by 0.20 credits, and execution uses the average of the starting and ending quote. A trader can submit up to three orders of 1–30 shares each. No borrowing or short selling.</p><p>Settlement uses that same batch: each share pays <strong>10 + the agent’s accuracy percentage</strong>, so an 80% score pays 90 credits. All positions close, and the next round draws the next unused batch. Because traders see the score they settle against, the market carries no forecasting risk.</p><p className="modal-note">Demo uses simulated agents with your uploaded questions or generated math. Live uses configured AI providers with your custom dataset or GSM8K, and incurs API charges. Start a new session to change modes. This is a local, single-process research prototype.</p></> : <><h2 id="dialog-title">{workerDetail.name}’s benchmark</h2><p>{workerDetail.style} · Latest accuracy {workerDetail.score ?? '—'}{workerDetail.score !== null && '%'} · {credits(workerDetail.price)} cr / share</p>{workerDetail.diagnostics && <p>{workerDetail.diagnostics.repeat_agreement !== undefined && <>Exact repeat agreement: {workerDetail.diagnostics.repeat_agreement}% · </>}{workerDetail.diagnostics.numeric_valid_count !== undefined && <>Valid numeric answers: {workerDetail.diagnostics.numeric_valid_count}/{workerDetail.answers.length} · Mean absolute error: {workerDetail.diagnostics.mean_absolute_error?.toFixed(2) ?? '—'} · Signed grading bias: {workerDetail.diagnostics.grading_bias?.toFixed(2) ?? '—'}</>}</p>}{!workerDetail.answers.length && <p>Run a round to inspect this worker’s questions, submitted answers, and independently scored results.</p>}<div className="answer-list">{workerDetail.answers.map((a, i) => <div key={i}><span className={a.correct ? 'positive' : 'negative'}>{a.correct ? '✓' : '×'} Question {(i % batchSize) + 1}{a.attempt > 1 ? ` · Trial ${a.attempt}` : ''}</span><p>{a.question}</p><small>Submitted: {typeof a.answer === 'object' ? JSON.stringify(a.answer) : String(a.answer)} · Expected: {a.expected}</small>{a.evaluation_reason && <small className="evaluation-reason">{a.evaluation_score !== undefined ? `Gemini: ${a.evaluation_score}/100 · ` : ''}{a.evaluation_reason}</small>}</div>)}</div></>}</section></div>}
  </div>;
}

function IntegrationPanel({ market, mode }) {
  const integrations = market?.integrations;
  const config = market?.configuration || integrations?.configuration;
  const missing = integrations?.missing_keys || [];
  return <section className="integration-panel" aria-label="Integration status"><div className="integration-title"><Sparkles size={14}/><strong>Model and storage settings</strong><span>{mode === 'demo' ? 'Configured lineup · demo remains simulated' : 'Live provider configuration'}</span></div><div className="integration-grid"><div><small>COMPETING WORKERS</small><strong>{config?.workers?.map(w => w.provider).join(' / ') || 'Configuration unavailable'}</strong><p>{config?.workers?.map((w, i) => `${['Atlas', 'Nova', 'Orbit'][i]}: ${w.model}`).join(' · ')}</p></div><div><small>TRADING INTELLIGENCE</small><strong>{config?.trader?.provider || '—'} <span>× 5 strategies</span></strong><p>{config?.trader?.model || 'Awaiting configuration'} · analyst: {config?.analyst?.provider || '—'}</p></div><div><small>HISTORY & SETTLEMENT</small><strong>{integrations?.database || 'Connecting…'}</strong><p>Solana: {integrations?.solana || 'Not connected'} · virtual credit settlement</p></div></div>{(missing.length > 0 || integrations?.error) && <p className="integration-warning">{integrations?.error || `Live mode needs: ${missing.join(', ')}. Demo is ready without credentials.`}</p>}</section>;
}

function Metric({ label, value, detail, icon }) { return <div className="metric"><div className="metric-label">{label}{icon}</div><strong>{value}</strong><small>{detail}</small></div>; }
