import { loadState, saveState } from './state.js';
import { directory } from './directory.js';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64(s)));
let jwks;

async function accessEmail(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return '';
  const [h, p, sig] = token.split('.');
  if (!sig) return '';
  try {
    if (!jwks || Date.now() - jwks.at > 3_600_000) {
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

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const allowed = String(env.NU_ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    const login = await accessEmail(request, env);
    const email = login ? (allowed.includes(login) ? login : '') : (env.DEV_IDENTITY === '1' ? 'dev@localhost' : '');
    if (!path.startsWith('/api/')) return email ? env.ASSETS.fetch(request) : new Response('Bitte anmelden.', { status: 401 });

    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    const reader = !!env.NU_READ_TOKEN && same(bearer, env.NU_READ_TOKEN);

    if (path === '/api/directory' && request.method === 'GET' && (email || reader)) {
      return json(directory((await loadState(env.DB)).state || {}));
    }
    if (!email) return json({ error: 'Bitte anmelden.' }, 401);

    if (path === '/api/state') {
      if (request.method === 'GET') return json(await loadState(env.DB));
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
