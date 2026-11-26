import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto, enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await subtle.exportKey('jwk', pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };

export const TEAM = 'test.cloudflareaccess.com', AUD = 'test-aud';
export const accessBindings = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS: JSON.stringify({ keys: [jwk] }) };

export async function as(email) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: [AUD], iss: 'https://' + TEAM, email, exp: Math.floor(Date.now() / 1000) + 300 }));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(head + '.' + body));
  return { 'cf-access-jwt-assertion': head + '.' + body + '.' + b64u(sig) };
}
