import { loadState, saveState, loadRow, saveRow } from './state.js';
import { directory } from './directory.js';
import { withRatings, ratingsView, setRating } from './ratings.js';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64(s)));
let jwks;

async function accessEmail(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return '';
  const [h, p, sig] = token.split('.');
  if (!sig) return '';
  try {
    if (env.CF_ACCESS_JWKS) jwks = { keys: JSON.parse(env.CF_ACCESS_JWKS).keys, at: Date.now() };
    else if (!jwks || Date.now() - jwks.at > 3_600_000) {
      const res = await fetch(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      jwks = { keys: (await res.json()).keys, at: Date.now() };
    }
    const head = part(h), body = part(p), jwk = jwks.keys.find((k) => k.kid === head.kid);
    if (head.alg !== 'RS256' || !jwk) return '';
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(h + '.' + p)))) return '';
    if (![].concat(body.aud).includes(env.CF_ACCESS_AUD) || body.iss !== 'https://' + env.CF_ACCESS_TEAM_DOMAIN || !(body.exp * 1000 > Date.now())) return '';
    return String(body.email || '').trim().toLowerCase();
  } catch { return ''; }
}

const json = (v, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const same = (a, b) => a.length === b.length && [...a].every((c, i) => c === b[i]);

// Obermonteure get the ratings page only. Only code and styles are served to them, never the data snapshots.
const ASSET = /.(mjs|js|css|html|png|svg|ico|woff2?|gz|wasm)$/;
const isObermonteur = async (plan, email) => !!plan && !!(await plan.prepare("SELECT 1 AS ok FROM users WHERE lower(email) = ? AND access_role = 'obermonteur'").bind(email).first());

async function saveRating(request, env, email) {
  const text = await request.text();
  let body;
  try { body = text.length < 20_000 ? JSON.parse(text) : null; } catch { body = null; }
  if (!body) return json({ error: 'Ungültige Anfrage.' }, 400);
  for (let i = 0; i < 3; i++) {
    const { state } = await loadState(env.DB), { state: ratings, token } = await loadRow(env.DB, 'ratings');
    let next;
    try { next = setRating(ratings || {}, state || {}, String(body.id || ''), body.assessment, email, new Date().toISOString()); } catch (e) { return json({ error: e.message }, 400); }
    const r = await saveRow(env.DB, 'ratings', JSON.stringify(next), token, email);
    if (r.status === 200) return json({ ok: true });
    if (r.status !== 409) return json({ error: 'Nicht gespeichert.' }, r.status);
  }
  return json({ error: 'Gleichzeitig geändert. Bitte erneut speichern.' }, 409);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const allowed = String(env.NU_ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    const login = await accessEmail(request, env);
    let email = '', role = '';
    if (login) {
      if (allowed.includes(login)) { email = login; role = 'full'; }
      else if (await isObermonteur(env.PLAN, login)) { email = login; role = 'ratings'; }
    } else if (env.DEV_IDENTITY === '1') { email = 'dev@localhost'; role = env.DEV_ROLE === 'ratings' ? 'ratings' : 'full'; }
    if (!path.startsWith('/api/')) {
      if (!email) return new Response('Bitte anmelden.', { status: 401 });
      if (role === 'ratings' && path !== '/' && !ASSET.test(path)) return new Response('Kein Zugriff.', { status: 403 });
      return env.ASSETS.fetch(request);
    }

    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    const reader = !!env.NU_READ_TOKEN && same(bearer, env.NU_READ_TOKEN);

    if (path === '/api/directory' && request.method === 'GET' && (role === 'full' || reader)) {
      return json(directory((await loadState(env.DB)).state || {}));
    }
    if (!email) return json({ error: 'Bitte anmelden.' }, 401);

    if (path === '/api/ratings' && request.method === 'PUT') return saveRating(request, env, email);
    if (role !== 'full') {
      if (path === '/api/state' && request.method === 'GET') {
        const { state } = await loadState(env.DB), { state: ratings } = await loadRow(env.DB, 'ratings');
        return json({ mode: 'ratings', state: ratingsView(withRatings(state, ratings || {})), token: '' });
      }
      return json({ error: 'Kein Zugriff.' }, 403);
    }

    // Projects come live from the Einteilung; the static snapshot is only the fallback.
    if (path === '/api/plan-projects' && request.method === 'GET') {
      const rows = env.PLAN ? (await env.PLAN.prepare('SELECT id, name, project_number, address, archived_at FROM projects ORDER BY name').all().catch(() => ({ results: [] }))).results : [];
      return json({ source: 'montageplanung', fetchedAt: new Date().toISOString(), projects: rows });
    }

    if (path === '/api/state') {
      if (request.method === 'GET') {
        const { state, token } = await loadState(env.DB), { state: ratings } = await loadRow(env.DB, 'ratings');
        return json({ mode: 'full', state: withRatings(state, ratings || {}), token });
      }
      if (request.method === 'PUT') {
        const r = await saveState(env.DB, await request.text(), request.headers.get('if-match') || '', email);
        return json(r, r.status);
      }
    }
    const m = path.match(/^\/api\/files\/([\w-]{1,80})$/);
    if (m) {
      const key = m[1];
      if (request.method === 'PUT') {
        await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } });
        return json({ ok: true });
      }
      if (request.method === 'GET') {
        const o = await env.BUCKET.get(key);
        return o ? new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : json({ error: 'Nicht gefunden.' }, 404);
      }
      if (request.method === 'DELETE') { await env.BUCKET.delete(key); return json({ ok: true }); }
    }
    return json({ error: 'Nicht gefunden.' }, 404);
  },
};
