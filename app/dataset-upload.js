'use client';

import BenchmarkSetup from './benchmark-setup';
import FileConverter from './file-converter';

export default function DatasetUpload({ dataset, locked, disabled, refresh, onNewSession, running, onDatasetUploaded }) {
  return <section className="panel dataset-panel" aria-labelledby="dataset-title">
    <div><h2 id="dataset-title">Your niche. Your benchmark.</h2>
      <p>Compare models on your own material. Upload worksheets, describe what you need the model to do, and choose how its answers are evaluated.</p></div>
    <FileConverter disabled={disabled} refresh={refresh}/>
    {locked && <div role="status"><p>{running ? 'A simulation is running. Wait for it to finish, then start a new session to choose different worksheets or criteria.' : 'This session already has benchmark results. Start a new session to choose different worksheets or criteria. This clears the active market; completed-round archives are retained.'}</p><button type="button" className="text-button" disabled={running || disabled} onClick={onNewSession}>New session to edit benchmark</button></div>}
    <BenchmarkSetup dataset={dataset} locked={locked || disabled} refresh={refresh} onSaved={plan => onDatasetUploaded({ ...dataset, benchmark_plan: plan })}/>
    <p className="dataset-status" role="status">{dataset ? `${dataset.name} · ${dataset.count} questions · ${dataset.benchmark_plan ? `Saved ${dataset.benchmark_plan.method === 'items' ? 'item-count' : dataset.benchmark_plan.method} benchmark` : `${dataset.scoring === 'numeric' ? 'Numeric' : 'Exact text'} scoring`} · ${dataset.remaining_rounds} rounds remaining` : 'Default: GSM8K in live mode; generated math in demo mode.'}</p>
    <p>Each round uses 20 questions: 10 public and 10 held back for settlement. Tick several worksheets in the menu next to Run to combine them. {locked ? 'Start a new session to change worksheets.' : 'Live runs send questions to the configured providers. Only upload material you have permission to share. Demo runs simulate answers and do not establish model performance.'}</p>
  </section>;
}
