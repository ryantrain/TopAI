'use client';

import { useState } from 'react';
import { Check, Loader2, Upload } from 'lucide-react';
import { readApiResponse } from './api-response.mjs';

const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Could not read the file.'));
  reader.readAsDataURL(file);
});

// Each uploaded worksheet is turned into benchmark questions on the server and saved to the worksheet menu.
export default function FileConverter({ disabled, refresh }) {
  const [pending, setPending] = useState('');
  const [added, setAdded] = useState(null);
  const [errors, setErrors] = useState([]);

  async function upload(files) {
    setAdded(null); setErrors([]);
    const entries = [], failed = [];
    let selected = true;
    for (const [i, file] of files.entries()) {
      setPending(files.length > 1 ? `Reading ${file.name} (${i + 1} of ${files.length})…` : `Reading ${file.name}…`);
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.');
        const response = await fetch('/api/library/convert', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, mime_type: file.type, data: await readBase64(file) }),
        });
        const result = await readApiResponse(response);
        entries.push(result.entry);
        selected = result.selected;
      } catch (e) { failed.push(`${file.name}: ${e.message}`); }
    }
    try {
      // Everything uploaded together runs together.
      if (selected && entries.length > 1) {
        await readApiResponse(await fetch('/api/library/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: entries.map(e => e.id) }) }));
      }
      await refresh();
    } catch (e) { failed.push(e.message); }
    setErrors(failed);
    setAdded(entries.length ? { entries, selected } : null);
    setPending('');
  }

  const total = added?.entries.reduce((n, e) => n + e.count, 0) || 0;
  const unkeyed = added?.entries.reduce((n, e) => n + e.model_answers, 0) || 0;
  return <div className="file-converter">
    <div><h3>Upload worksheets</h3>
      <p>Add one or more worksheets as PDFs, photos, Word, Excel, PowerPoint or text files. Their questions and answers become your benchmark, and each worksheet is saved in the worksheet menu next to Run.</p></div>
    <label className={`converter-drop ${pending ? 'busy' : ''}`}><input type="file" multiple aria-label="Upload worksheets" disabled={disabled || !!pending} onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) upload(files); }}/>
      {pending ? <><Loader2 size={15} className="spin"/> {pending}</> : <><Upload size={15}/> Choose worksheets</>}</label>
    {errors.map(message => <p role="alert" className="dataset-error" key={message}>{message}</p>)}
    {added && <p role="status" className="converter-result"><Check size={14}/><span>
      Added <strong>{added.entries.length === 1 ? added.entries[0].name : `${added.entries.length} worksheets`}</strong> · {total} questions.{' '}
      {!added.selected ? 'Saved to the worksheet menu. Start a new session to use it.' : total >= 20 ? 'Selected. Describe your need below, or press Run at the top right.' : 'Selected, but a round needs 20 questions. Add more worksheets, or tick saved ones in the menu next to Run.'}
      {unkeyed > 0 && ` ${unkeyed} ${unkeyed === 1 ? 'answer was' : 'answers were'} not in an answer key and ${unkeyed === 1 ? 'was' : 'were'} worked out automatically, so check ${unkeyed === 1 ? 'it' : 'them'}.`}</span></p>}
  </div>;
}
