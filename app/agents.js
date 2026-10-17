'use client';

import { ChevronDown } from 'lucide-react';

// Characters a user can seat at each of the backend's three worker desks.
// Colors are validated as one categorical set (dataviz validate_palette, all pairs).
export const ROSTER = {
  mochi: { name: 'Mochi', color: '#e2679a' },
  sky: { name: 'Sky', color: '#0ea5c6' },
  moss: { name: 'Moss', color: '#1d7a43' },
  sunny: { name: 'Sunny', color: '#d9a300' },
  ruby: { name: 'Ruby', color: '#c8372d' },
  bao: { name: 'Bao', color: '#6d4fd6' },
};
export const DEFAULT_SEATS = ['mochi', 'sky', 'moss'];

// Map backend worker ids (atlas, nova, orbit) to the seated character.
export function seatedAgents(workers, seats) {
  return workers.map((w, i) => {
    const key = seats[i] || DEFAULT_SEATS[i];
    return { ...w, key, name: ROSTER[key].name, color: ROSTER[key].color };
  });
}

// A small figure seen from behind, working at a desk. `state` is idle | working | waiting | done.
export function Workstation({ agent, state }) {
  const prop = ['mug', 'books', 'plant'][Object.keys(ROSTER).indexOf(agent.key) % 3];
  return <svg className={`workstation ws-${state}`} viewBox="0 0 200 172" aria-hidden="true">
    <ellipse cx="100" cy="164" rx="70" ry="5" fill="#000" opacity=".05"/>
    <rect x="40" y="104" width="5" height="58" rx="1" fill="#c9c4ba"/>
    <rect x="155" y="104" width="5" height="58" rx="1" fill="#c9c4ba"/>
    <rect x="28" y="96" width="144" height="9" rx="2.5" fill="#e3cfab"/>
    <rect x="94" y="80" width="12" height="16" fill="#2b3550"/>
    <rect x="82" y="93" width="36" height="4" rx="2" fill="#2b3550"/>
    <rect x="58" y="28" width="84" height="54" rx="5" fill="#1f2a44"/>
    <g className="screen">
      <rect x="62" y="32" width="76" height="46" rx="2" fill="#26355a"/>
      <g className="code">
        {[[0, 30], [1, 46], [2, 22], [3, 38], [4, 28]].map(([i, w]) => <rect key={i} className={`line l${i}`} x={i % 2 ? 74 : 68} y={38 + i * 7} width={w} height="3" rx="1.5" fill={i === 1 ? agent.color : '#c9d3ea'} opacity={i === 1 ? .9 : .55}/>)}
        <rect className="cursor" x="100" y="66" width="2" height="5" fill="#ffffff"/>
      </g>
      <g className="check"><circle cx="100" cy="55" r="11" fill={agent.color}/><path d="M94.5 55.5 L98.5 59.5 L106 51.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></g>
    </g>
    {prop === 'mug' && <g><rect x="146" y="84" width="11" height="12" rx="2" fill={agent.color} opacity=".85"/><path d="M157 87 q5 0 5 4 q0 4 -5 4" fill="none" stroke={agent.color} strokeWidth="2" opacity=".85"/><path className="steam" d="M150 80 q-2 -4 0 -8 M154 80 q-2 -4 0 -8" fill="none" stroke="#c9c4ba" strokeWidth="1.5" strokeLinecap="round"/></g>}
    {prop === 'books' && <g><rect x="142" y="88" width="22" height="4" rx="1" fill={agent.color} opacity=".85"/><rect x="144" y="84" width="19" height="4" rx="1" fill="#8b93a7"/><rect x="143" y="92" width="21" height="4" rx="1" fill="#c9c4ba"/></g>}
    {prop === 'plant' && <g><path d="M152 86 q-8 -10 -2 -16 q4 6 2 16 M152 86 q6 -12 12 -12 q-2 9 -12 12" fill="#4f8a5e"/><rect x="146" y="85" width="12" height="11" rx="2" fill={agent.color} opacity=".85"/></g>}
    <g className="person">
      <g className="hands"><circle className="hand-l" cx="80" cy="99" r="5" fill="#e2b896"/><circle className="hand-r" cx="120" cy="99" r="5" fill="#e2b896"/></g>
      <path className="body" d="M66 150 Q64 108 100 104 Q136 108 134 150 Z" fill={agent.color}/>
      <path d="M86 106 Q100 116 114 106" fill="none" stroke="#000" strokeOpacity=".12" strokeWidth="2"/>
      <g className="head"><circle cx="100" cy="86" r="16" fill="#3a3a44"/><circle cx="84.5" cy="88" r="3.2" fill="#e2b896"/><circle cx="115.5" cy="88" r="3.2" fill="#e2b896"/></g>
    </g>
    <rect x="70" y="118" width="60" height="34" rx="7" fill="#1f2a44"/>
    <rect x="97" y="152" width="6" height="8" fill="#9aa0ad"/>
    <rect x="80" y="159" width="40" height="3" rx="1.5" fill="#9aa0ad"/>
  </svg>;
}

function AgentTile({ agent, index, model, state, status, score, top, seats, onSeat, onOpen }) {
  const taken = new Set(seats.filter((_, i) => i !== index));
  const Frame = onOpen ? 'button' : 'div';
  return <figure className={`agent agent-${state} ${top ? 'top' : ''}`} style={{ '--agent': agent.color, '--delay': `${index * -0.9}s` }}>
    <Frame type={onOpen ? 'button' : undefined} className="agent-frame" onClick={onOpen || undefined} aria-label={onOpen ? `Open ${agent.name}'s latest answers` : undefined}>
      <Workstation agent={agent} state={state}/>
      {status && <span className="agent-status">{state === 'working' && <i className="typing"><b/><b/><b/></i>}{status}</span>}
      {score && <span className="agent-score">{score}</span>}
      {top && <span className="agent-top">Top of class</span>}
    </Frame>
    <figcaption>
      {onSeat
        ? <label className="seat-select"><span className="swatch"/><select aria-label={`Agent at desk ${index + 1}`} value={agent.key} onChange={e => onSeat(index, e.target.value)}>
            {Object.entries(ROSTER).map(([key, a]) => <option key={key} value={key} disabled={taken.has(key)}>{a.name}</option>)}
          </select><ChevronDown size={14} aria-hidden="true"/></label>
        : <span className="seat-name"><span className="swatch"/>{agent.name}</span>}
      <small>{model || 'Model not configured'}</small>
    </figcaption>
  </figure>;
}

export default function AgentsPanel({ agents, models, state, statuses = {}, scores = {}, top, seats, onSeat, onOpen, compact }) {
  return <section className={`agents-panel ${compact ? 'compact' : ''}`} aria-label="Agents">
    <div className="panel-label"><span>Classroom</span><small>{agents.length ? `${agents.length} desks` : 'Connecting…'}</small></div>
    <div className="agent-grid">
      {agents.map((a, i) => <AgentTile key={a.id} agent={a} index={i} model={models[i]} state={state} status={statuses[a.id]} score={scores[a.id]}
        top={top === a.id} seats={seats} onSeat={onSeat} onOpen={onOpen ? () => onOpen(a.id) : null}/>)}
    </div>
  </section>;
}
