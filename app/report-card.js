'use client';

import { ChevronDown } from 'lucide-react';
import { letterGrade } from './model-metrics.mjs';
import { AgentImage } from './agents';

const show = (v, f) => v === null || v === undefined ? '—' : f(v);

export function Recommendation({ pick, minimum, setMinimum }) {
  if (!pick) return null;
  const w = pick.worker;
  return <section className="verdict" style={{ '--agent': w.color }}>
    <AgentImage agent={w} working/>
    <div>
      <small>{w.provider === 'simulated' ? 'Demo fallback result' : 'API agent result'}</small>
      <h2>{pick.qualified ? `Use ${w.name}` : `Nobody reached ${minimum}%. ${w.name} came closest.`}</h2>
      <p>{w.name} ({w.provider === 'simulated' ? 'simulated' : w.model || 'agent'}) answered {w.gradedCorrect} of {w.gradedAttempted} correctly ({w.accuracy.toFixed(0)}%)
        {w.speed !== null ? `, about ${w.speed.toFixed(1)} s per question` : ''}
        {w.cost !== null ? `, about $${w.cost.toFixed(4)} in total` : ''}. Based on your worksheet and these runs only.</p>
    </div>
    <label className="threshold">Good enough at<select value={minimum} onChange={e => setMinimum(Number(e.target.value))}>{[50, 60, 70, 80, 90, 95, 100].map(v => <option key={v} value={v}>{v}%</option>)}</select></label>
  </section>;
}

export default function ReportCard({ rows, winner, onSelect, countItems }) {
  return <details className="drawer result-table" open>
    <summary>Final results<ChevronDown size={16} aria-hidden="true"/></summary>
    <p className="section-note">Totals across every quiz. Select an agent to see their marked answers.</p>
    <div className="table-wrap"><table>
      <thead><tr><th>Agent</th><th>Grade</th><th className="num">Overall</th><th className="num">Accuracy</th><th className="num">{countItems ? 'Items / 1k tok' : 'Correct / 1k tok'}</th><th className="num">Time / q</th><th className="num">Est. cost</th></tr></thead>
      <tbody>{rows.map(w => <tr key={w.id} className={winner === w.id ? 'top' : ''}>
        <td><button type="button" className="agent-cell" onClick={() => onSelect(w.id)}><i style={{ background: w.color }}/><span><strong>{w.name}</strong><small>{w.provider === 'simulated' ? 'simulated demo agent' : [w.provider, w.model].filter(Boolean).join(' · ')}</small></span></button></td>
        <td><span className="grade">{letterGrade(w.accuracy)}</span></td>
        <td className="num">{show(w.overall, v => v.toFixed(0))}</td>
        <td className="num">{w.gradedAttempted ? `${w.accuracy.toFixed(0)}%` : '—'}<small> {w.gradedAttempted ? `${w.gradedCorrect}/${w.gradedAttempted}` : ''}</small></td>
        <td className="num">{show(w.efficiency, v => v.toFixed(2))}</td>
        <td className="num">{show(w.speed, v => `${v.toFixed(2)} s`)}</td>
        <td className="num">{show(w.cost, v => `$${v.toFixed(4)}`)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="fine-print">Grade from accuracy: A ≥ 90%, B ≥ 80%, C ≥ 70%, D ≥ 60%. Overall (0–100) combines correct answers per token and per second, relative to the best agent. Cost uses your configured token prices.</p>
  </details>;
}
