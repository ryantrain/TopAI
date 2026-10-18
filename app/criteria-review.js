'use client';

import { Check, Loader2, RefreshCw } from 'lucide-react';
import { JUDGES, RUBRICS } from './judges.mjs';

export const METHODS = {
  exact: 'Exact answer / label',
  numeric: 'Numeric agreement',
  json: 'Structured JSON equality',
  rubric: 'Rubric judge (Gemini, Qwen backup)',
  items: 'Count distinct generated items',
};

// Review the marking plan Qwen drafted from the user's task, before it is saved and run.
export default function CriteriaReview({ plan, change, rounds, setRounds, maxRounds, state, draftError, stale, onSave, onRedraft }) {
  const rubric = plan.method === 'rubric';
  const preset = RUBRICS.find(r => r.text === plan.rubric)?.id;
  const saving = state === 'saving';
  return <section className="criteria" aria-labelledby="criteria-title">
    <div className="criteria-head">
      <div><h2 id="criteria-title">Marking plan</h2>
        <p>{state === 'saved' ? 'Saved. Press ↑ to start the class.'
          : draftError === 'skipped' ? 'Fill in how answers are marked, or press Redraft to let Qwen draft it.' : draftError ? `Could not draft a plan automatically (${draftError}). Fill it in below.`
          : 'Drafted from your task by local Qwen. Check it, then save.'}</p></div>
      <button type="button" className="link-button" onClick={onRedraft} disabled={saving}><RefreshCw size={13}/>{stale ? 'Task changed · redraft' : 'Redraft'}</button>
    </div>

    {plan.unsupported_requirements?.length > 0 && <div className="unsupported"><strong>Not measured by this setup</strong><ul>{plan.unsupported_requirements.map(r => <li key={r}>{r}</li>)}</ul></div>}

    <div className="criteria-grid">
      <label>Evaluate using<select value={plan.method} onChange={e => change('method', e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {rubric && <label>Passing judge score / 100<input type="number" min="1" max="100" value={plan.pass_score} onChange={e => change('pass_score', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
      {plan.method === 'numeric' && <label>Allowed error (±)<input type="number" min="0" step="0.000001" value={plan.tolerance} onChange={e => change('tolerance', e.target.value === '' ? '' : Number(e.target.value))}/></label>}
      {plan.method === 'items' && <label>Items to count<input maxLength={40} value={plan.output_unit} onChange={e => change('output_unit', e.target.value)}/></label>}
      {!rubric && plan.method !== 'numeric' && plan.method !== 'items' && <span/>}

      {rubric && <div className="wide judge-row" role="radiogroup" aria-label="Judge">
        <span className="field-label">Judge</span>
        {JUDGES.map(j => <span key={j.id} className={`judge-pill ${j.connected ? 'on' : ''}`} role="radio" aria-checked={j.connected} aria-disabled={!j.connected}
          title={j.connected ? undefined : 'Not connected yet'}>{j.connected && <Check size={12}/>}{j.name}{j.role ? ` · ${j.role}` : ''}</span>)}
      </div>}

      {rubric && <label className="wide">Judge criteria
        <span className="rubric-presets">{RUBRICS.map(r => <button type="button" key={r.id} className={`chip action ${preset === r.id ? 'picked' : ''}`} onClick={() => change('rubric', r.text)}>{r.name}</button>)}</span>
        <textarea rows={4} maxLength={8000} value={plan.rubric} onChange={e => change('rubric', e.target.value)} placeholder="What a passing answer must include, and what makes it fail."/></label>}

      <label className="wide">Instructions every agent gets<textarea rows={2} maxLength={8000} value={plan.instructions} onChange={e => change('instructions', e.target.value)} placeholder="Answer format and requirements. Never include the answer key."/></label>

      <div className="wide criteria-run">
        <label>Repeats<select value={plan.repetitions ?? 1} onChange={e => change('repetitions', Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}× per question</option>)}</select></label>
        <label>Questions per round<input type="number" min="1" max="50" value={plan.batch_size ?? 20} onChange={e => change('batch_size', e.target.value === '' ? '' : Math.max(1, Math.min(50, Math.round(Number(e.target.value)))))}/></label>
        <label>Rounds<select value={rounds} onChange={e => setRounds(Number(e.target.value))}>{Array.from({ length: Math.max(1, Math.min(10, maxRounds)) }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    </div>

    {plan.procedure && <p className="muted procedure"><strong>How the test runs:</strong> {plan.procedure}</p>}
    <div className="criteria-actions">
      <button type="button" className="primary-button" onClick={onSave} disabled={saving || state === 'saved' || (rubric && !plan.rubric?.trim())}>
        {saving ? <Loader2 size={14} className="spin"/> : state === 'saved' ? <Check size={14}/> : null}{state === 'saved' ? 'Criteria saved' : 'Save benchmark criteria'}</button>
      <p className="muted">{rubric ? 'Gemini marks each answer against these criteria; if Gemini has no API key or hits its rate limit, local Qwen marks instead. Judge scores are estimates, so spot-check them in each agent\'s answers. Practice runs compare with the answer key instead of calling the judge.' : 'Scoring runs directly in Python against your answer key.'}</p>
    </div>
  </section>;
}
