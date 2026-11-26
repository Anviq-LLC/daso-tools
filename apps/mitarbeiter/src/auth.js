const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64(s)));
let jwks;

// The verified email of the Cloudflare Access login, or '' when there is none.
export async function accessEmail(request, env) {
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
