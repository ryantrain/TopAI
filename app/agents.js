'use client';

// Artwork follows the backend worker order. Configured runs may use one to six seats.
// Colors are validated as one categorical set (dataviz validate_palette, all pairs).
export const ROSTER = [
  { key: 'circle', name: 'Circle', color: '#c8553d' },
  { key: 'star', name: 'Star', color: '#d9a300' },
  { key: 'triangle', name: 'Triangle', color: '#2a78d6' },
  { key: 'cloud', name: 'Cloud', color: '#8b6fd6' },
  { key: 'cube', name: 'Cube', color: '#e8705c' },
  { key: 'cylinder', name: 'Cylinder', color: '#4fb57f' },
];
export const DEFAULT_ACTIVE = { circle: true, star: true, triangle: true, cloud: true, cube: true, cylinder: true };

export function seatedAgents(workers, active) {
  return workers.map((w, i) => {
    const a = ROSTER[i] || ROSTER[0];
    return { ...w, key: a.key, name: a.name, color: a.color, active: active[a.key] !== false };
  });
}

// Switched off: resting. Switched on: the still work image, or the animated GIF while a class runs
// (viewers who prefer reduced motion get the still work image instead).
export function AgentImage({ agent, working, animated }) {
  const still = `/agents/${agent.key}-${working ? 'work' : 'rest'}.png`;
  if (!animated) return <img className="agent-img" src={still} alt="" draggable="false"/>;
  return <picture><source srcSet={still} media="(prefers-reduced-motion: reduce)"/><img className="agent-img gif" src={`/agents/${agent.key}.gif`} alt="" draggable="false"/></picture>;
}

function AgentTile({ agent, index, model, state, status, score, top, onToggle, canTurnOff, onOpen }) {
  const on = agent.active;
  const Frame = onOpen && on && !agent.display ? 'button' : 'div';
  return <figure className={`agent agent-${on ? state : 'off'} ${top ? 'top' : ''}`} style={{ '--agent': agent.color, '--delay': `${index * -0.9}s` }}>
    <Frame type={Frame === 'button' ? 'button' : undefined} className="agent-frame" onClick={Frame === 'button' ? onOpen : undefined} aria-label={Frame === 'button' ? `Open ${agent.name}'s latest answers` : undefined}>
      <AgentImage agent={agent} working={on} animated={on && (state === 'working' || state === 'waiting')}/>
      {on && status && <span className="agent-status">{state === 'working' && <i className="typing"><b/><b/><b/></i>}{status}</span>}
      {on && score && <span className="agent-score">{score}</span>}
      {on && top && <span className="agent-top">Top of class</span>}
    </Frame>
    <figcaption>
      <div className="agent-name-row">
        <span className="seat-name"><span className="swatch"/>{agent.name}</span>
        {onToggle && <button type="button" role="switch" aria-checked={on} aria-label={`${agent.name} takes part`}
          className={`toggle ${on ? 'on' : ''}`} disabled={on && !canTurnOff} title={on && !canTurnOff ? 'At least one connected agent must take part' : undefined}
          onClick={() => onToggle(agent.key)}><i/></button>}
      </div>
      <small>{on ? model || 'Model not configured' : 'Off · not in this class'}</small>
    </figcaption>
  </figure>;
}

export default function AgentsPanel({ agents: all, models, state, statuses = {}, scores = {}, top, onToggle, onOpen, compact }) {
  const onCount = all.filter(a => a.active).length;
  const realOn = all.filter(a => a.active).length;
  // Once a class starts, only the switched-on agents are shown.
  const agents = compact ? all.filter(a => a.active) : all;
  return <section className={`agents-panel ${compact ? 'compact' : ''}`} aria-label="Agents">
    <div className="panel-label"><span>Classroom</span><small>{!all.length ? 'Connecting…' : compact ? `${onCount} ${onCount === 1 ? 'agent' : 'agents'} in class` : `${onCount} of ${all.length} agents in class`}</small></div>
    <div className="agent-grid">
      {agents.map((a, i) => <AgentTile key={a.id} agent={a} index={i} model={models[all.indexOf(a)]} state={state} status={statuses[a.id]} score={scores[a.id]}
        top={top === a.id} onToggle={onToggle} canTurnOff={realOn > 1} onOpen={onOpen ? () => onOpen(a.id) : null}/>)}
    </div>
  </section>;
}
