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

function AgentTile({ agent, index, model, state, status, score, top, seats, onSeat, onOpen }) {
  const taken = new Set(seats.filter((_, i) => i !== index));
  const Frame = onOpen ? 'button' : 'div';
  return <figure className={`agent agent-${state} ${top ? 'top' : ''}`} style={{ '--agent': agent.color, '--delay': `${index * -0.9}s` }}>
    <Frame type={onOpen ? 'button' : undefined} className="agent-frame" onClick={onOpen || undefined} aria-label={onOpen ? `Open ${agent.name}'s latest answers` : undefined}>
      <img src={`/agents/${agent.key}.png`} alt="" draggable="false"/>
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
    <div className="panel-label"><span>Classroom</span><small>{agents.length} desks</small></div>
    <div className="agent-grid">
      {agents.map((a, i) => <AgentTile key={a.id} agent={a} index={i} model={models[i]} state={state} status={statuses[a.id]} score={scores[a.id]}
        top={top === a.id} seats={seats} onSeat={onSeat} onOpen={onOpen ? () => onOpen(a.id) : null}/>)}
    </div>
  </section>;
}
