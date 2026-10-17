export async function readApiResponse(response) {
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The server returned an unreadable response. Check that the backend is running and try again.'); }
  if (!response.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map(item => `${item.loc?.slice(1).join('.') || 'Criteria'}: ${item.msg}`).join('; ')
      : typeof detail === 'string' ? detail : 'Request failed. Try again.';
    throw new Error(message);
  }
  return data;
}
