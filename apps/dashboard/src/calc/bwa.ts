// BWA / SuSa rows -> buckets. A file is never summed with another file for the same period.
import { bwaMetrics, type AccountingReport } from './accounting-pdf.ts';
export type Line = { account: string; label: string; cents: number; bucket?: string };
export type Mapping = { pattern: string; bucket: string };
export const BUCKETS = ['umsatz', 'personal', 'sub', 'material', 'buero', 'kfz', 'agk', 'bgk', 'sonstige_kosten', 'zinsen', 'steuern', 'betriebsergebnis', 'ergebnis_vst', 'ignorieren'] as const;
export const COST_BUCKETS = ['personal', 'sub', 'material', 'buero', 'kfz', 'agk', 'bgk', 'sonstige_kosten'];

// "1.234,56", "-1234.5", "1.234,56-", "1.234,56 H" -> cents (trailing minus or H = negative as the DATEV export writes it)
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/\s|€|EUR/gi, '');
  if (!/\d/.test(s)) return null;
  let neg = false;
  if (/[-]$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/[HhSs]$/.test(s)) { neg = neg || /[Hh]$/.test(s); s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

// Spreadsheet rows: first 3-8 digit cell is the account (SuSa), first text cell the label, last amount cell the balance.
export function linesFromRows(rows: unknown[][]): Line[] {
  const out: Line[] = [];
  for (const row of rows) {
    const cells = row.map((c) => (c === null || c === undefined ? '' : c));
    let account = '', label = '', cents: number | null = null;
    for (const c of cells) {
      const t = String(c).trim();
      if (!account && /^\d{3,8}$/.test(t)) { account = t; continue; }
      if (!label && t && parseAmount(t) === null) label = t;
    }
    for (let k = cells.length - 1; k >= 0; k--) {
      const t = String(cells[k]).trim();
      if (t === String(account)) continue;
      const a = parseAmount(cells[k]);
      if (a !== null && t !== '') { cents = a; break; }
    }
    if (cents !== null && (account || label)) out.push({ account, label, cents });
  }
  return out;
}

// PDF text pasted into the review mask: "4120 Gehaelter 12.345,67" per line.
export function linesFromText(text: string): Line[] {
  return linesFromRows(text.split(/\r?\n/).map((l) => {
    const m = l.trim().match(/^(\d{3,8})?\s*(.*?)\s+(-?[\d.]+,\d{2}-?\s?[HS]?)$/i);
    return m ? [m[1] || '', m[2], m[3]] : [];
  }));
}

export function bucketOf(line: Line, mapping: Mapping[]): string {
  for (const m of mapping) {
    if (m.pattern.startsWith('~')) { if (line.label.toLowerCase().includes(m.pattern.slice(1).toLowerCase())) return m.bucket; }
    else if (line.account && line.account.startsWith(m.pattern)) return m.bucket;
  }
  return '';
}

export function summarize(lines: (Line & { bucket: string })[]) {
  const by: Record<string, number> = {};
  for (const l of lines) if (l.bucket && l.bucket !== 'ignorieren') by[l.bucket] = (by[l.bucket] || 0) + l.cents;
  // SuSa writes credits (Haben, revenue) as negative and debits (Soll, costs) as positive: compare magnitudes per bucket.
  const revenue = Math.abs(by.umsatz || 0);
  const costs = COST_BUCKETS.reduce((s, b) => s + Math.abs(by[b] || 0), 0);
  // BWA key figures carry their own sign (losses are negative) and win over the rebuilt value
  const operating = 'betriebsergebnis' in by ? by.betriebsergebnis : revenue - costs;
  const beforeTax = 'ergebnis_vst' in by ? by.ergebnis_vst : operating - Math.abs(by.zinsen || 0);
  return { by, revenue, costs, operating, beforeTax, margin: revenue ? Math.round((operating / revenue) * 1000) / 10 : null };
}

// Expected cost by standard category from the last actual period; the suggestion never changes a booked value.
export const SUGGEST: Record<string, string> = { Büro: 'buero', Kfz: 'kfz', AGK: 'agk', BGK: 'bgk' };
export function suggest(by: Record<string, number>, current: { name: string; monthly: number }[]) {
  return current.filter((c) => SUGGEST[c.name]).map((c) => {
    const proposed = Math.abs(by[SUGGEST[c.name]] || 0);
    return { name: c.name, current: c.monthly, proposed, deviation: proposed - c.monthly };
  });
}

// Typical DATEV BWA labels and SKR03 ranges as a starting point. Real files must be checked in the review mask.
export const DEFAULT_MAPPING: Mapping[] = [
  { pattern: '~umsatzerl', bucket: 'umsatz' }, { pattern: '8', bucket: 'umsatz' },
  { pattern: '~personalkosten', bucket: 'personal' }, { pattern: '41', bucket: 'personal' },
  { pattern: '~fremdleistung', bucket: 'sub' }, { pattern: '~nachunternehmer', bucket: 'sub' }, { pattern: '3100', bucket: 'sub' },
  { pattern: '~wareneinsatz', bucket: 'material' }, { pattern: '3', bucket: 'material' },
  { pattern: '~raumkosten', bucket: 'buero' }, { pattern: '~bürobedarf', bucket: 'buero' }, { pattern: '49', bucket: 'buero' },
  { pattern: '~kfz', bucket: 'kfz' }, { pattern: '~fahrzeug', bucket: 'kfz' }, { pattern: '4530', bucket: 'kfz' },
  { pattern: '~zinsen', bucket: 'zinsen' }, { pattern: '~summe', bucket: 'ignorieren' }, { pattern: '~gesamt', bucket: 'ignorieren' },
];

// Top-level rows of the DATEV short-term income statement (names differ a little between months). Sub-rows are not stored.
const BWA_ROWS: [RegExp, string][] = [
  [/^Umsatzerl/i, 'umsatz'], [/^(Mat\.\/Wareneinkauf|Wareneinsatz)$/i, 'material'], [/^Personalkosten$/i, 'personal'],
  [/^Raumkosten$/i, 'buero'], [/^Fahrzeugko/i, 'kfz'],
  [/^(Betriebl\.?|Betriebliche) Steuern$/i, 'sonstige_kosten'], [/^Versich\.?(erungen)?\/Beitr/i, 'sonstige_kosten'],
  [/^Besondere Kosten$/i, 'sonstige_kosten'], [/^Werbe-\/Reisekosten$/i, 'sonstige_kosten'], [/^Kosten Warenabgabe$/i, 'sonstige_kosten'],
  [/^Abschreibungen$/i, 'sonstige_kosten'], [/^Reparatur\/Instandh/i, 'sonstige_kosten'], [/^Sonstige Kosten$/i, 'sonstige_kosten'],
  [/^Betriebsergebnis$/i, 'betriebsergebnis'], [/^Ergebnis vor Steuern$/i, 'ergebnis_vst'],
];

// SKR03 fallback when the saved mapping does not know an account: balance sheet accounts do not count.
function susaBucket(account: string): string {
  if (/^21/.test(account)) return 'zinsen';
  if (/^[0-2679]/.test(account)) return 'ignorieren';
  return /^4/.test(account) ? 'sonstige_kosten' : '';
}

// Parsed PDF -> import lines. SuSa: net month movement (Soll minus Haben) of accounts that moved. BWA: month column of the top-level rows.
export function pdfLines(r: AccountingReport): Line[] {
  if (r.kind === 'susa') {
    return r.rows.filter((x) => x.debit !== x.credit)
      .map((x) => ({ account: x.account, label: x.label, cents: x.debit - x.credit, bucket: susaBucket(x.account) }));
  }
  const done = new Set<RegExp>(), out: Line[] = [];
  for (const row of r.rows) {
    const hit = BWA_ROWS.find(([re]) => re.test(row.label.replace(/\s+/g, ' ').trim()));
    if (!hit || row.month === null || done.has(hit[0])) continue;
    done.add(hit[0]);
    out.push({ account: '', label: row.label, cents: row.month, bucket: hit[1] });
  }
  return out;
}

// A report sent by the browser is rebuilt field by field; totals are recomputed, never taken from the client.
const money = (v: unknown, required = false): number | null => {
  if (v === null || v === undefined) { if (required) throw new Error('Betrag fehlt.'); return null; }
  if (!Number.isSafeInteger(v)) throw new Error('Ungültiger Betrag.');
  return v as number;
};
export function checkReport(raw: unknown, kind: string, period: string): AccountingReport {
  const r = raw as { kind?: string; period?: string; rows?: Record<string, unknown>[] };
  if (!r || r.kind !== kind || r.period !== period || !Array.isArray(r.rows) || !r.rows.length || r.rows.length > 2000) throw new Error('Ungültiger Bericht.');
  const text = (v: unknown, max: number) => { if (typeof v !== 'string') throw new Error('Ungültiger Text.'); return v.slice(0, max); };
  if (kind === 'susa') {
    return { kind: 'susa', period, rows: r.rows.map((x) => ({
      account: text(x.account, 12), label: text(x.label, 200), opening: money(x.opening), debit: money(x.debit, true)!, credit: money(x.credit, true)!,
      ytdDebit: money(x.ytdDebit), ytdCredit: money(x.ytdCredit), balance: money(x.balance),
    })) };
  }
  const rows = r.rows.map((x) => ({ label: text(x.label, 200), month: money(x.month), ytd: money(x.ytd), prior: money(x.prior) }));
  const { revenue, ...metrics } = bwaMetrics(rows);
  if (revenue === null) throw new Error('In der BWA fehlen die Umsatzerlöse.');
  return { kind: 'bwa', period, rows, revenue, ...metrics };
}
