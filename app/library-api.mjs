import { readApiResponse } from './api-response.mjs';

export const MAX_UPLOAD = 10 * 1024 * 1024;

const readBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Could not read the file.'));
  reader.readAsDataURL(file);
});

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Send each file to the backend converter (CSV/JSON imported as-is; PDFs, images and Office files read by Gemini).
// onProgress(index, update) reports { status: 'reading' | 'added' | 'failed', entry?, message? } per file.
export async function uploadWorksheets(files, onProgress = () => {}) {
  const added = [];
  let selected = true;
  for (const [i, file] of files.entries()) {
    onProgress(i, { status: 'reading' });
    try {
      if (file.size > MAX_UPLOAD) throw new Error('Choose a file smaller than 10 MB.');
      const result = await readApiResponse(await fetch('/api/library/convert', json('POST', { filename: file.name, mime_type: file.type, data: await readBase64(file) })));
      added.push(result.entry);
      selected = result.selected;
      onProgress(i, { status: 'added', entry: result.entry });
    } catch (e) { onProgress(i, { status: 'failed', message: e.message }); }
  }
  // Everything uploaded together runs together.
  if (selected && added.length > 1) await selectWorksheets(added.map(e => e.id));
  return { added, selected };
}

export const selectWorksheets = async ids => readApiResponse(await fetch('/api/library/selection', json('PUT', { ids })));
export const removeWorksheet = async id => readApiResponse(await fetch(`/api/library/${id}`, { method: 'DELETE' }));
export const fetchWorksheet = async id => readApiResponse(await fetch(`/api/library/${id}`, { cache: 'no-store' }));
