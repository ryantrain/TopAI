'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Round a raw tick spacing up to 1, 2 or 5 × 10^n so axis labels stay readable while the scale glides.
const niceStep = (raw) => {
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= raw);
};

// Segments per second while drawing; the last stretch of each segment eases into its point.
const DRAW_SPEED = 2.25;

// One animation loop draws each new result quickly and eases the vertical scale.
function useChartAnimation(rows, keys) {
  const inputs = useRef({ rows, keys });
  inputs.current = { rows, keys };
  const [view, setView] = useState({ head: null, top: null });
  useEffect(() => {
    let frame, previous = performance.now(), head = null, top = null;
    const step = (now) => {
      const dt = Math.min(now - previous, 100) / 1000;
      previous = now;
      const { rows, keys } = inputs.current;
      const last = rows.length - 1;
      if (last >= 0) {
        // First load, a new session, a range switch or a long backlog snaps into place instead of replaying.
        const snap = head === null || last < Math.floor(head) || last - head > 6;
        head = snap ? last : Math.min(last, head + dt * Math.min(DRAW_SPEED, 0.15 + (last - head) * 6.75));
        if (last - head < 1e-3) head = last;
        const values = rows.slice(0, Math.ceil(head) + 1).flatMap(r => keys.map(k => r[k])).filter(Number.isFinite);
        const target = Math.max(1, ...values) * 1.15;
        top = snap || top === null ? target : top + (target - top) * (1 - Math.exp(-dt / 0.25));
        setView(v => Math.abs(v.head - head) < 1e-4 && Math.abs(v.top - top) < 1e-4 ? v : { head, top });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);
  return view;
}

export default function PerformanceChart({ rows, workers, formatter, loading }) {
  const keys = workers.map(w => w.id);
  const { head, top } = useChartAnimation(rows, keys);
  const whole = head === null ? rows.length - 1 : Math.min(Math.floor(head), rows.length - 1);
  const data = rows.slice(0, whole + 1).map((row, x) => ({ ...row, x }));
  const from = rows[whole], to = rows[whole + 1];
  if (head !== null && to && head > whole) {
    // The segment being drawn ends at an interpolated point between the last two results.
    const f = head - whole;
    data.push({ ...to, x: head, partial: true, ...Object.fromEntries(keys.map(k => [k, Number.isFinite(from[k]) && Number.isFinite(to[k]) ? from[k] + (to[k] - from[k]) * f : null])) });
  }
  const end = Math.max(head ?? rows.length - 1, 1);
  const label = (x) => rows[Math.round(x)]?.label ?? '';
  const yTop = top ?? 1;
  const yStep = niceStep(yTop / 4);
  // While a round runs and the line has caught up, the next result is still being measured.
  const waiting = loading && (head === null || head >= rows.length - 1);
  const yTicks = Array.from({ length: Math.floor(yTop / yStep) + 1 }, (_, i) => +(i * yStep).toFixed(6));
  return <div className="chart performance-chart">
    {waiting && rows.length > 0 && <span className="chart-loading" role="status"><Loader2 size={13} className="spin"/> Measuring next batch</span>}
    {waiting && rows.length === 0 && <div className="chart-loading-first" role="status"><Loader2 size={22} className="spin"/>Running the first benchmark…</div>}
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 16, right: 8, left: -25, bottom: 0 }}>
    <defs><linearGradient id="marketFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.12}/><stop offset="100%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5"/>
    <XAxis dataKey="x" type="number" domain={[0, end]} niceTicks="none" ticks={data.filter(d => !d.partial).map(d => d.x)} tickFormatter={label} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} minTickGap={75} tickMargin={15}/>
    <YAxis domain={[0, yTop]} niceTicks="none" ticks={yTicks} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }}/>
    <Tooltip labelFormatter={label} contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#17202e', fontSize: 12 }} formatter={formatter}/>
    <Area type="linear" dataKey="atlas" name="Atlas" stroke="none" fill="url(#marketFill)" legendType="none" tooltipType="none" isAnimationActive={false}/>
    {workers.map(w => <Line key={w.id} type="linear" dataKey={w.id} name={w.name} stroke={w.color} strokeWidth={2} activeDot={{ r: 4 }} isAnimationActive={false}
      dot={({ cx, cy, payload, index }) => payload.partial || cx == null || cy == null ? <g key={index}/> : <g key={index}>
        {waiting && index === rows.length - 1 && <circle className="head-pulse" cx={cx} cy={cy} r={4} fill={w.color}/>}
        <circle cx={cx} cy={cy} r={3} fill="#ffffff" stroke={w.color} strokeWidth={2}/></g>}/>)}
  </ComposedChart></ResponsiveContainer></div>;
}
