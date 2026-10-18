'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ASPECTS, cumulativeSeries } from './model-metrics.mjs';

export const formatAspect = (aspect, v) => v === null || v === undefined ? '—'
  : aspect === 'accuracy' ? `${v.toFixed(0)}%`
  : aspect === 'cost' ? `$${v.toFixed(4)}`
  : aspect === 'speed' ? `${v.toFixed(2)} s`
  : aspect === 'overall' ? v.toFixed(0) : v.toFixed(2);

function ChartTooltip({ active, payload, label, aspect }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip"><strong>{label}</strong>{payload.map(p => <span key={p.dataKey}><i style={{ background: p.color }}/>{p.name}<b>{formatAspect(aspect, p.value)}</b></span>)}</div>;
}

// Name label at the end of each line, so identity never relies on color alone.
const endLabel = (name, last) => function EndLabel({ x, y, index }) {
  return index === last ? <text x={x + 9} y={y} dy={4} fontSize={11} fill="#4a4a52">{name}</text> : null;
};

// Running totals per aspect, one point per marked part of a round.
export default function ProgressChart({ agents, countItems, live, height = 300 }) {
  const [aspect, setAspect] = useState('accuracy');
  const rows = cumulativeSeries(agents, aspect, countItems);
  const hasData = rows.some(r => agents.some(w => r[w.id] !== null && r[w.id] !== undefined));
  const info = ASPECTS[aspect];
  return <div className="chart-shell">
    <div className="folder-tabs" role="tablist" aria-label="Aspect to inspect">
      {Object.entries(ASPECTS).map(([key, a]) => <button type="button" role="tab" aria-selected={aspect === key} key={key} className={aspect === key ? 'on' : ''} onClick={() => setAspect(key)}>{a.label}</button>)}
    </div>
    <section className="chart-card" aria-label={`${info.label} chart`}>
      <div className="chart-head">
        <div><h2>{info.label}{live && <span className="live-dot">Live</span>}</h2><p>{info.hint} {info.better === 'lower' ? 'Lower is better.' : 'Higher is better.'}</p></div>
        <div className="legend">{agents.map(w => <span key={w.id}><i style={{ background: w.color }}/>{w.name}<b>{formatAspect(aspect, rows.at(-1)?.[w.id])}</b></span>)}</div>
      </div>
      <div className="chart-box" style={{ height }}>
        {hasData
          ? <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 10, right: 56, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#eeece7"/>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8a8a93', fontSize: 11 }} tickMargin={10}/>
              <YAxis width={48} domain={aspect === 'accuracy' || aspect === 'overall' ? [0, 100] : [0, 'auto']} axisLine={false} tickLine={false} tick={{ fill: '#8a8a93', fontSize: 11 }} tickFormatter={v => aspect === 'cost' ? `$${v}` : v}/>
              <Tooltip content={<ChartTooltip aspect={aspect}/>} cursor={{ stroke: '#d6d3cc', strokeDasharray: '3 3' }}/>
              {agents.map(w => <Line key={w.id} type="monotone" dataKey={w.id} name={w.name} stroke={w.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }} label={endLabel(w.name, rows.length - 1)} connectNulls isAnimationActive={false}/>)}
            </LineChart></ResponsiveContainer>
          : <div className="chart-empty">{rows.length ? `No ${info.label.toLowerCase()} data for these runs.${aspect === 'cost' ? ' Set WORKER_COST_PER_1K_TOKENS to estimate cost.' : ''}` : 'The first points appear when round 1 is marked.'}</div>}
      </div>
      <p className="fine-print">Running totals after each round. Results apply to these worksheets only.</p>
    </section>
  </div>;
}
