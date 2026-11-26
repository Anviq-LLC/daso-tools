// Shared storage. Falls back to the browser only when no server API exists (static preview).
let token = null, remote = false, queue = Promise.resolve(), dirty = false, locked = false;

export const isRemote = () => remote;

export async function loadRemote() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  if (res.status === 404 || !(res.headers.get('content-type') || '').includes('json')) return null;
  if (!res.ok) throw new Error('Gemeinsame Daten konnten nicht geladen werden (' + res.status + '). Bitte Seite neu laden.');
  const j = await res.json();
  remote = true;
  token = j.token;
  return { state: j.state, mode: j.mode || 'full' };
}

// Ratings have their own save path, so rating someone never changes the token of the main state.
export async function putRating(id, assessment) {
  if (!remote) return;
  const res = await fetch('/api/ratings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, assessment }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'Speichern fehlgeschlagen (' + res.status + ')');
}

function lock() {
  locked = true;
  document.body.insertAdjacentHTML('afterbegin', '<div style="position:fixed;z-index:99999;inset:0 0 auto 0;background:#b42318;color:#fff;padding:14px;text-align:center;font:600 15px sans-serif">Die Daten wurden von jemand anderem geändert. Eigene Änderungen wurden nicht gespeichert. Bitte Seite neu laden.</div>');
}

export function pushState(state) {
  if (!remote || locked) return;
  const body = JSON.stringify(state);
  dirty = true;
  queue = queue.then(async () => {
    if (!dirty || locked) return;
    dirty = false;
    const res = await fetch('/api/state', { method: 'PUT', headers: { 'If-Match': token, 'Content-Type': 'application/json' }, body });
    if (res.status === 409) return lock();
    if (!res.ok) { dirty = true; throw new Error('Speichern fehlgeschlagen (' + res.status + ')'); }
    token = (await res.json()).token;
  }).catch((e) => console.error(e));
}

export async function remoteFile(op, id, value) {
  if (op === 'clear') throw new Error('Im gemeinsamen Betrieb gesperrt.');
  const url = '/api/files/' + encodeURIComponent(id);
  if (op === 'put') {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': value.type || 'application/octet-stream' }, body: value });
    if (!r.ok) throw new Error('Upload fehlgeschlagen');
    return;
  }
  if (op === 'delete') { await fetch(url, { method: 'DELETE' }); return; }
  const r = await fetch(url);
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error('Download fehlgeschlagen');
  return r.blob();
}
