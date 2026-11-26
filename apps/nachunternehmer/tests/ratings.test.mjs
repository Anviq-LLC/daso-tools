import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';
import { saveState } from '../src/state.js';
import { ratingsView, withRatings, setRating } from '../src/ratings.js';

const { subtle } = webcrypto, enc = new TextEncoder(), b64u = (b) => Buffer.from(b).toString('base64url');
const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await subtle.exportKey('jwk', pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
const TEAM = 'test.cloudflareaccess.com', AUD = 'test-aud';

async function token(email) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: [AUD], iss: 'https://' + TEAM, email, exp: Math.floor(Date.now() / 1000) + 300 }));
  return head + '.' + body + '.' + b64u(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(head + '.' + body)));
}

function d1(setup) {
  const db = new DatabaseSync(':memory:');
  db.exec(setup);
  return {
    prepare: (sql) => ({
      bind: (...a) => ({
        run: async () => ({ meta: { changes: db.prepare(sql).run(...a).changes } }),
        first: async () => db.prepare(sql).get(...a) ?? null,
      }),
      first: async () => db.prepare(sql).get() ?? null,
    }),
  };
}

const seedState = {
  companies: [{ id: 'c1', name: 'Firma A', rate: 40, owner: 'Inhaber Geheim' }],
  teams: [{ id: 't1', companyId: 'c1', name: 'Team 1' }],
  workers: [{ id: 'w1', companyId: 'c1', teamId: 't1', name: 'Max Muster', role: 'Monteur', rate: 35, identity: { birth: '1990-01-01', docNo: 'X123456' }, assessment: null }],
  docs: [{ id: 'd1', workerId: 'w1', name: 'ausweis.pdf' }],
  projectAgreements: [{ id: 'a1', companyId: 'c1', fitterRateCents: 3500 }],
};

async function setup() {
  const DB = d1(readFileSync(new URL('../migrations/0001_state.sql', import.meta.url), 'utf8'));
  const PLAN = d1("CREATE TABLE users (id text primary key, email text not null, name text, access_role text); INSERT INTO users VALUES ('1','Ober@x.invalid','Ober','obermonteur'),('2','monteur@x.invalid','Monteur','monteur')");
  assert.equal((await saveState(DB, JSON.stringify(seedState), 'initial', 'seed')).status, 200);
  const env = {
    DB, PLAN, ASSETS: { fetch: async () => new Response('asset') },
    BUCKET: { get() { throw Error('files must not be touched'); }, put() { throw Error('files must not be touched'); }, delete() { throw Error('files must not be touched'); } },
    CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS: JSON.stringify({ keys: [jwk] }), NU_ALLOWED_EMAILS: 'boss@x.invalid',
  };
  const call = async (who, method, path, body, headers = {}) => worker.fetch(new Request('https://nu.test' + path, {
    method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { ...(who ? { 'cf-access-jwt-assertion': await token(who) } : {}), ...headers },
  }), env);
  return { call };
}

const good = { quality: 8, speed: 6, languages: ['Deutsch'], experience: 'gt5' };

test('Obermonteur gets names and ratings, nothing else', async () => {
  const { call } = await setup();
  const r = await call('ober@x.invalid', 'GET', '/api/state');
  assert.equal(r.status, 200);
  const text = await r.text(), j = JSON.parse(text);
  assert.equal(j.mode, 'ratings');
  assert.deepEqual(j.state.workers.map((w) => w.name), ['Max Muster']);
  for (const secret of ['X123456', '1990-01-01', 'Inhaber Geheim', 'ausweis.pdf', 'identity', '"rate"', 'fitterRateCents']) assert.ok(!text.includes(secret), secret);
});

test('Obermonteur is refused everywhere else, including data snapshots', async () => {
  const { call } = await setup();
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/state', '{"workers":[]}', { 'if-match': 'initial' })).status, 403);
  assert.equal((await call('ober@x.invalid', 'GET', '/api/files/abc')).status, 403);
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/files/abc', 'x')).status, 403);
  assert.equal((await call('ober@x.invalid', 'GET', '/api/directory')).status, 403);
  for (const path of ['/data-read.json', '/aufmass-nu.json', '/api-snapshot.json', '/plan-projects.json', '/sub-teams-read.json']) assert.equal((await call('ober@x.invalid', 'GET', path)).status, 403, path);
  for (const path of ['/', '/app.js', '/styles.css', '/store.mjs']) assert.equal((await call('ober@x.invalid', 'GET', path)).status, 200, path);
});

test('Monteure and strangers get nothing, full users keep everything', async () => {
  const { call } = await setup();
  for (const who of ['monteur@x.invalid', 'stranger@x.invalid', '']) {
    assert.equal((await call(who, 'GET', '/api/state')).status, 401, who);
    assert.equal((await call(who, 'GET', '/')).status, 401, who);
    assert.equal((await call(who, 'PUT', '/api/ratings', { id: 'w1', assessment: good })).status, 401, who);
  }
  const full = await (await call('boss@x.invalid', 'GET', '/api/state')).json();
  assert.equal(full.mode, 'full');
  assert.equal(full.state.workers[0].identity.docNo, 'X123456');
  assert.equal((await call('boss@x.invalid', 'GET', '/api/directory')).status, 200);
});

test('A rating from an Obermonteur does not touch the main state token', async () => {
  const { call } = await setup();
  const before = await (await call('boss@x.invalid', 'GET', '/api/state')).json();
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', { id: 'w1', assessment: good })).status, 200);
  const after = await (await call('boss@x.invalid', 'GET', '/api/state')).json();
  assert.equal(after.token, before.token, 'open copies stay saveable');
  assert.equal(after.state.workers[0].assessment.quality, 8);
  const limited = await (await call('ober@x.invalid', 'GET', '/api/state')).json();
  assert.equal(limited.state.workers[0].assessment.speed, 6);
  // a save from a copy that still has no rating must not wipe the new one
  const stale = { ...seedState };
  assert.equal((await call('boss@x.invalid', 'PUT', '/api/state', stale, { 'if-match': before.token })).status, 200);
  assert.equal((await (await call('boss@x.invalid', 'GET', '/api/state')).json()).state.workers[0].assessment.quality, 8);
});

test('Full users rate through the same path, later ratings replace earlier ones', async () => {
  const { call } = await setup();
  assert.equal((await call('boss@x.invalid', 'PUT', '/api/ratings', { id: 'w1', assessment: good })).status, 200);
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', { id: 'w1', assessment: { ...good, quality: 3 } })).status, 200);
  assert.equal((await (await call('boss@x.invalid', 'GET', '/api/state')).json()).state.workers[0].assessment.quality, 3);
});

test('Bad ratings are refused and change nothing', async () => {
  const { call } = await setup();
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', { id: 'w1', assessment: { ...good, quality: 11 } })).status, 400);
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', { id: 'nobody', assessment: good })).status, 400);
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', 'kein json')).status, 400);
  assert.equal((await call('ober@x.invalid', 'PUT', '/api/ratings', { id: 'w1', assessment: { ...good, experience: 'ever' } })).status, 400);
  assert.equal((await (await call('boss@x.invalid', 'GET', '/api/state')).json()).state.workers[0].assessment, null);
});

test('ratingsView, withRatings and setRating on their own', () => {
  const view = ratingsView(seedState);
  assert.deepEqual(Object.keys(view.workers[0]).sort(), ['assessment', 'companyId', 'id', 'name', 'role', 'teamId']);
  assert.equal(ratingsView(null).workers.length, 0);
  const merged = withRatings(seedState, setRating({}, seedState, 'w1', good, 'a@x', 'now'));
  assert.equal(merged.workers[0].assessment.quality, 8);
  assert.equal(seedState.workers[0].assessment, null, 'input stays untouched');
  assert.throws(() => setRating({}, seedState, 'zz', good, 'a@x', 'now'), /nicht gefunden/);
});
