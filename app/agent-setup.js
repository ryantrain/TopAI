'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { readApiResponse } from './api-response.mjs';
import { ROSTER } from './agents';

const PROVIDERS = {
  openai: { label: 'OpenAI', model: 'gpt-4o-mini' },
  gemini: { label: 'Gemini', model: 'gemini-2.5-flash-lite' },
  anthropic: { label: 'Anthropic', model: 'claude-sonnet-4-6' },
  ollama: { label: 'Local Ollama', model: 'qwen2.5:7b' },
};

const CUSTOM_MODEL = '__custom__';
const MODEL_OPTIONS = {
  openai: [
    ['gpt-4o-mini', 'GPT-4o mini'],
  ],
  anthropic: [
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
  ],
};

const blank = (provider = 'openai', index = 0) => ({
  provider, model: PROVIDERS[provider].model, api_key: '', label: ROSTER[index]?.name || `Agent ${index + 1}`,
});

export default function AgentSetup({ configuration, onConfigured, onDemo }) {
  const [agents, setAgents] = useState(() => configuration?.workers?.length
    ? configuration.workers.map(({ provider, model, label }, index) => ({ provider, model, api_key: '', label: label || ROSTER[index]?.name || `Agent ${index + 1}` }))
    : [blank()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function change(index, key, value) {
    setAgents(current => current.map((agent, i) => i === index
      ? key === 'provider' ? { ...blank(value, index), label: agent.label } : { ...agent, [key]: value }
      : agent));
  }

  function modelField(agent, index) {
    const options = MODEL_OPTIONS[agent.provider];
    if (!options) return <label><span>Model name</span><input required maxLength={200} value={agent.model}
      onChange={e => change(index, 'model', e.target.value)} placeholder={PROVIDERS[agent.provider].model}/></label>;
    const preset = options.some(([value]) => value === agent.model) ? agent.model : CUSTOM_MODEL;
    return <label className="model-choice"><span>Model</span>
      <select value={preset} onChange={e => change(index, 'model', e.target.value === CUSTOM_MODEL ? '' : e.target.value)}>
        {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        <option value={CUSTOM_MODEL}>Custom model…</option>
      </select>
      {preset === CUSTOM_MODEL && <input required maxLength={200} value={agent.model}
        onChange={e => change(index, 'model', e.target.value)} placeholder="Enter exact model ID" aria-label="Custom model ID"/>}
    </label>;
  }

  async function submit(event) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      await readApiResponse(await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agents }),
      }));
      await onConfigured();
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  return <section className="agent-setup" aria-labelledby="agent-setup-title">
    <div className="agent-setup-head">
      <span className="setup-icon"><KeyRound size={18}/></span>
      <div><p className="eyebrow">First, choose who takes the test</p><h2 id="agent-setup-title">Connect up to six AI agents</h2>
        <p>Each agent receives the same questions. API keys stay in backend memory and are never saved to the database.</p></div>
    </div>
    <form onSubmit={submit}>
      <div className="agent-config-list">
        {agents.map((agent, index) => <div className="agent-config-row" key={index}>
          <div className="config-agent-icon" style={{ '--agent': ROSTER[index].color }}>
            <img src={`/agents/${ROSTER[index].key}-rest.png`} alt="" draggable="false"/>
            <small>Agent {index + 1}</small>
          </div>
          <label><span>Display name</span><input required maxLength={40} value={agent.label} onChange={e => change(index, 'label', e.target.value)} placeholder={ROSTER[index].name}/></label>
          <label><span>Provider</span><select value={agent.provider} onChange={e => change(index, 'provider', e.target.value)}>
            {Object.entries(PROVIDERS).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}
          </select></label>
          {modelField(agent, index)}
          {agent.provider === 'ollama'
            ? <div className="local-key"><span>API key</span><small>Runs locally</small></div>
            : <label><span>API key</span><input type="password" autoComplete="off" maxLength={1000} value={agent.api_key} onChange={e => change(index, 'api_key', e.target.value)} placeholder="Paste key or use .env"/></label>}
          <button type="button" className="remove-agent" aria-label={`Remove agent ${index + 1}`} disabled={agents.length === 1 || pending}
            onClick={() => setAgents(current => current.filter((_, i) => i !== index))}><Trash2 size={15}/></button>
        </div>)}
      </div>
      {agents.length < 6 && <button type="button" className="add-agent" disabled={pending} onClick={() => setAgents(current => [...current, blank('openai', current.length)])}><Plus size={14}/>Add another agent</button>}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <div className="agent-setup-actions">
        <button type="button" className="demo-button" disabled={pending} onClick={onDemo}>Skip and use 3 demo agents</button>
        <button type="submit" className="connect-button" disabled={pending}>{pending ? <Loader2 size={15} className="spin"/> : <KeyRound size={15}/>}Use {agents.length} real {agents.length === 1 ? 'agent' : 'agents'}</button>
      </div>
    </form>
  </section>;
}
