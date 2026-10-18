'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ASPECTS, cumulativeSeries } from './model-metrics.mjs';

export const formatAspect = (aspect, v) => v === null || v === undefined ? '—'
  : aspect === 'accuracy' ? `${v.toFixed(0)}%`
  : aspect === 'cost' ? `$${v.toFixed(4)}`
  : aspect === 'speed' ? `${v.toFixed(2)} s`
  : aspect === 'overall' ? v.toFixed(0) : v.toFixed(2);

// Drawing speed: one new quiz takes SEGMENT seconds; redrawing the whole history never takes longer than FULL.
const SEGMENT = 0.6;
const FULL = 1.47;
// The value axis glides to a new range with this time constant instead of snapping.
const AXIS_EASE = 0.14;
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

// Moves the drawn length (in points) toward the newest point, and the axis ranges toward their targets,
// one animation frame at a time. A new aspect tab redraws from the first point. The clock starts once the
// chart has been painted, so the drawing is never spent before it is on screen.
function useDrawIn(end, yTarget, restartKey, box) {
  const [frame, setFrame] = useState(() => ({ progress: 0, xMax: Math.max(1, end), yMax: yTarget }));
  const current = useRef(frame);
  useEffect(() => { current.current = { ...current.current, progress: 0, yMax: yTarget }; }, [restartKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const xTarget = Math.max(1, end);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = { progress: end, xMax: xTarget, yMax: yTarget };
      setFrame(current.current);
      return;
    }
    const from = Math.min(current.current.progress, end);
    // The time axis moves on the same curve as the line, so the tip rides the right edge while earlier quizzes slide left.
    const xFrom = current.current.xMax;
    const duration = Math.min(FULL, Math.max(SEGMENT, (end - from) * SEGMENT * 0.6));
    // Elapsed time advances at most one short frame per frame, so a busy main thread pauses the drawing instead of skipping it.
    let raf, elapsed = null, last = null;
    const step = now => {
      if (elapsed === null && !box.current?.querySelector('.recharts-line')) { raf = requestAnimationFrame(step); return; }
      const dt = last === null ? 0 : Math.min(0.034, (now - last) / 1000);
      last = now;
      elapsed = (elapsed ?? 0) + dt;
      const t = Math.min(1, elapsed / duration);
      const k = 1 - Math.exp(-dt / AXIS_EASE);
      const c = current.current;
      const next = { progress: from + (end - from) * ease(t), xMax: xFrom + (xTarget - xFrom) * ease(t), yMax: c.yMax + (yTarget - c.yMax) * k };
      const settled = t >= 1 && Math.abs(next.yMax - yTarget) < 1e-3 * Math.max(1, yTarget);
      if (settled) Object.assign(next, { progress: end, xMax: xTarget, yMax: yTarget });
      current.current = next;
      setFrame(next);
      if (!settled) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [end, yTarget, restartKey]);
  return frame;
}

// The finished points so far, plus a moving tip between the last finished point and the next one.
function visibleRows(rows, ids, progress) {
  const whole = Math.min(rows.length - 1, Math.floor(progress + 1e-6));
  const out = rows.slice(0, whole + 1).map((row, i) => ({ ...row, x: i }));
  const fraction = progress - whole;
  if (fraction > 1e-3 && rows[whole + 1]) {
    const a = rows[whole], b = rows[whole + 1], tip = { x: progress, tip: true };
    for (const id of ids) tip[id] = a[id] == null || b[id] == null ? null : a[id] + (b[id] - a[id]) * fraction;
    out.push(tip);
  }
  return out;
}

function ChartTooltip({ active, payload, rows, aspect }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || point.tip) return null;
  return <div className="chart-tip"><strong>{rows[point.x]?.label}</strong>{payload.map(p => <span key={p.dataKey}><i style={{ background: p.color }}/>{p.name}<b>{formatAspect(aspect, p.value)}</b></span>)}</div>;
}

// The moving tip carries a haloed point along the line and leaves a finished point at each quiz it passes.
// Recharts rebuilds these elements every frame, so they are styled statically rather than with CSS animations.
const dot = (color, last, drawing) => function Dot({ cx, cy, index, payload }) {
  if (cx == null || cy == null) return null;
  if (payload?.tip && index === last && drawing) return <g key={index}><circle cx={cx} cy={cy} r={9} fill={color} opacity={0.2}/><circle cx={cx} cy={cy} r={4} fill={color} stroke="#ffffff" strokeWidth={2}/></g>;
  if (payload?.tip) return null;
  return <circle key={index} cx={cx} cy={cy} r={4} fill={color} stroke="#ffffff" strokeWidth={2}/>;
};

// Name label rides at the end of each line, so identity never relies on color alone.
const endLabel = (name, last) => function EndLabel({ x, y, index }) {
  return index === last && x != null && y != null ? <text x={x + 9} y={y} dy={4} fontSize={11} fill="#4a4a52">{name}</text> : null;
};

// Running totals per aspect, one point per completed quiz, drawn in as each quiz finishes.
export default function ProgressChart({ agents, countItems, live, height = 300 }) {
  const [aspect, setAspect] = useState('accuracy');
  const box = useRef(null);
  // Recompute the series only when a quiz finishes, not on every animation frame or poll.
  const signature = agents.map(w => `${w.id}:${w.scores?.length || 0}`).join('|');
  const rows = useMemo(() => cumulativeSeries(agents, aspect, countItems), [signature, aspect, countItems]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = agents.map(w => w.id);
  const values = rows.flatMap(r => ids.map(id => r[id])).filter(v => Number.isFinite(v));
  const hasData = values.length > 0;
  const fixed = aspect === 'accuracy' || aspect === 'overall';
  const yTarget = fixed ? 100 : niceMax(Math.max(0, ...values) * 1.05);
  const end = Math.max(0, rows.length - 1);
  const frame = useDrawIn(end, yTarget, aspect, box);
  const shown = visibleRows(rows, ids, frame.progress);
  const drawing = frame.progress < end - 1e-3;
  const yTicks = Array.from({ length: 5 }, (_, i) => +(yTarget * i / 4).toPrecision(6));
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
      <div className="chart-box" ref={box} style={{ height }}>
        {hasData
          ? <ResponsiveContainer width="100%" height="100%"><LineChart data={shown} margin={{ top: 10, right: 56, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#eeece7"/>
              <XAxis type="number" dataKey="x" domain={[0, frame.xMax]} allowDataOverflow ticks={rows.map((_, i) => i)} interval="preserveStartEnd"
                tickFormatter={i => rows[i]?.label ?? ''} axisLine={false} tickLine={false} tick={{ fill: '#8a8a93', fontSize: 11 }} tickMargin={10} padding={{ left: 12, right: 12 }}/>
              <YAxis width={48} domain={[0, frame.yMax]} allowDataOverflow ticks={yTicks} axisLine={false} tickLine={false} tick={{ fill: '#8a8a93', fontSize: 11 }}
                tickFormatter={v => aspect === 'cost' ? `$${v}` : v}/>
              <Tooltip content={<ChartTooltip rows={rows} aspect={aspect}/>} cursor={{ stroke: '#d6d3cc', strokeDasharray: '3 3' }}/>
              {agents.map(w => <Line key={w.id} type="linear" dataKey={w.id} name={w.name} stroke={w.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round"
                dot={dot(w.color, shown.length - 1, drawing)} activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }} label={endLabel(w.name, shown.length - 1)} connectNulls isAnimationActive={false}/>)}
            </LineChart></ResponsiveContainer>
          : <div className="chart-empty">{rows.length ? `No ${info.label.toLowerCase()} data for these runs.${aspect === 'cost' ? ' Set WORKER_COST_PER_1K_TOKENS to estimate cost.' : ''}` : 'The first points appear when quiz 1 is marked.'}</div>}
      </div>
      <p className="fine-print">Running totals across completed quizzes. Results apply to this worksheet only.</p>
    </section>
  </div>;
}
