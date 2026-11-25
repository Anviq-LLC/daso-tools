import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.ts';
import worker from '../src/worker/index.ts';

const sql = ['0001_init', '0006_bwa_edited', '0008_bwa_report'].map((n) => readFileSync(new URL(`../migrations/${n}.sql`, import.meta.url), 'utf8')).join(';\n');
const env = { DB: memoryD1(sql), PLAN: memoryD1(), AUFMASS: memoryD1(), DASO_DEV_IDENTITY: '1' } as never;
const call = async (path: string, method = 'GET', json?: unknown) => {
  const res = await worker.fetch(new Request('https://x' + path, { method, headers: json ? { 'content-type': 'application/json' } : {}, body: json ? JSON.stringify(json) : undefined }), env);
  return { status: res.status, body: (await res.json()) as any };
};
const row = (label: string, month: number | null, ytd: number | null = null) => ({ label, month, ytd, prior: null });
const bwa = { kind: 'bwa', period: '2026-10', rows: [row('Umsatzerlöse', 1_281_170, 22_138_299), row('Personalkosten', 558_184), row('Betriebsergebnis', -215_965), row('Ergebnis vor Steuern', -213_957, 4_788_883)] };

test('PDF report import derives lines, is read back after accept, can be corrected and deleted', async () => {
  const made = await call('/api/bwa/import', 'POST', { kind: 'bwa', period: '2026-10', filename: 'bwa.pdf', format: 'pdf', lines: [], report: bwa });
  assert.equal(made.status, 201);
  assert.equal(made.body.unmapped, 0);
  assert.equal((await call('/api/accounting-reports?year=2026')).body.length, 0, 'not visible before accept');
  assert.equal((await call(`/api/bwa/${made.body.id}/accept`, 'POST')).status, 200);

  const out = (await call('/api/accounting-reports?year=2026')).body;
  assert.equal(out.length, 1);
  assert.equal(out[0].revenue, 1_281_170);
  assert.equal(out[0].beforeTax, -213_957);
  assert.equal(out[0].name, 'bwa.pdf');

  const fixed = structuredClone(bwa);
  fixed.rows[0].month = 1_300_000;
  assert.equal((await call(`/api/bwa/${made.body.id}/report`, 'PUT', { report: fixed })).body.changed, 1);
  assert.equal((await call('/api/accounting-reports?year=2026')).body[0].revenue, 1_300_000);
  const detail = (await call(`/api/bwa/${made.body.id}`)).body;
  assert.equal(detail.lines.find((l: any) => l.label === 'Umsatzerlöse').cents, 1_300_000);
  assert.ok(detail.import.edited_at);
  assert.equal((await call(`/api/bwa/${made.body.id}/lines`, 'POST', { edits: [{ n: 1, cents: 5 }] })).status, 409);

  assert.equal((await call(`/api/bwa/${made.body.id}`, 'DELETE')).status, 200);
  assert.equal((await call('/api/accounting-reports?year=2026')).body.length, 0);
  assert.equal((env as any).DB.raw.prepare('SELECT COUNT(*) AS n FROM bwa_line').get().n, 0);
});

test('a report that does not match its period is refused', async () => {
  const bad = await call('/api/bwa/import', 'POST', { kind: 'bwa', period: '2026-09', filename: 'x.pdf', format: 'pdf', lines: [], report: bwa });
  assert.equal(bad.status, 400);
});
