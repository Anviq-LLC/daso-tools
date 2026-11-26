import { expiryState, extractExpiry } from './core.mjs';

// Documents of which only the newest counts. Older uploads stay in the archive.
export const SINGLE_TYPES = ['Freistellungsbescheinigung', 'Unbedenklichkeitsbescheinigung', 'Betriebshaftpflicht'];
// Valid for three months from the issue date.
export const ISSUE_TYPES = ['Unbedenklichkeitsbescheinigung', 'Betriebshaftpflicht'];
export const SOCIAL_TYPES = ['A1-Bescheinigung', 'Sozialmeldebescheinigung', 'Sozialversicherung'];

const pad = (n) => String(n).padStart(2, '0');
const real = (y, m, d) => {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(iso + 'T12:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === iso ? iso : null;
};
const unique = (list) => { const u = [...new Set(list.filter(Boolean))]; return u.length === 1 ? u[0] : null; };

export function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = y * 12 + (m - 1) + months, ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}
export const issueValidUntil = (issuedOn) => addMonths(issuedOn, 3);

const DATE = '(\\d{1,2})[.\\/-](\\d{1,2})[.\\/-](\\d{4})';
const dates = (text, source) => [...text.matchAll(new RegExp(source, 'giu'))].map((m) => real(m[m.length - 1], m[m.length - 2], m[m.length - 3]));

// The date a document was issued, only when the text names it unambiguously.
export function extractIssueDate(text) {
  const labelled = dates(text, `(?:ausgestellt\\s*am|ausstellungsdatum|datum\\s*der\\s*ausstellung|ausstellungsdatum:?|ort,?\\s*datum|erstellt\\s*am)[\\s:–-]*${DATE}`);
  if (labelled.filter(Boolean).length) return unique(labelled);
  return unique(dates(text, `[A-ZÄÖÜ][a-zäöüß]+(?:\\s[A-ZÄÖÜ][a-zäöüß]+)?,\\s*(?:den\\s*)?${DATE}`));
}

// Freistellungsbescheinigung: "gültig bis ..." or the end of "vom ... bis ...".
export function extractFreistellungEnd(text) {
  const direct = extractExpiry(text);
  if (direct) return direct;
  return unique(dates(text, `(?:vom|ab\\s*dem|von)\\s*\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{4}\\s*bis(?:\\s*zum)?[\\s:–-]*${DATE}`));
}

const amount = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(Mio\.?|Millionen)?\s*(?:€|EUR\b|Euro\b)/i;
function euros(chunk) {
  const m = chunk.match(amount);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
  return Math.round(m[3] ? n * 1_000_000 : n);
}

// Deckungssummen in Euro and whether damage to subcontractors is covered; unreadable means "Nein".
export function parseInsurance(text) {
  const flat = text.replace(/\s+/g, ' ');
  const after = (re) => { const m = flat.match(re); return m ? euros(flat.slice(m.index, m.index + 160)) : null; };
  const both = after(/Personen-?\s*(?:und|u\.)\s*Sach(?:sch(?:ä|ae)den|sch\.)?/i);
  const personEuros = after(/Personensch(?:ä|ae)den/i) ?? both;
  const propertyEuros = after(/Sachsch(?:ä|ae)den/i) ?? both;
  const sentence = flat.split(/(?<=[.;])\s/).find((s) => /nachunternehmer|subunternehmer|fremdfirmen/i.test(s)) || '';
  const nuCovered = /mitversichert|eingeschlossen|eingeschl\./i.test(sentence) && !/nicht|kein|ausgeschlossen|ausgenommen/i.test(sentence);
  return { personEuros, propertyEuros, nuCovered };
}

const money = (n) => (n == null ? 'nicht lesbar' : n.toLocaleString('de-DE') + ' €');
export const insuranceLine = (i) => `Personenschäden ${money(i.personEuros)}, Sachschäden ${money(i.propertyEuros)}, Nachunternehmerschäden ${i.nuCovered ? 'ja' : 'nein'}`;

// Only the newest document of a single-copy type is current.
export function docIsLive(d, docs) {
  if (!SINGLE_TYPES.includes(d.type) || d.workerId || d.projectAgreementId) return true;
  const mine = docs.filter((x) => x.companyId === d.companyId && x.type === d.type && !x.workerId && !x.projectAgreementId);
  const key = (x) => (x.uploadedAt || '') + String(mine.indexOf(x)).padStart(6, '0');
  return mine.every((x) => key(x) <= key(d));
}

// Turns the upload form into the stored fields, or says what is missing.
export function prepareDoc(f) {
  const { issuedOn, personEuros, propertyEuros, nuCovered, title, ...rest } = f;
  const out = { ...rest };
  if (ISSUE_TYPES.includes(f.type)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn || '')) return { error: 'Bitte das Ausstellungsdatum eintragen. Die Gültigkeit beträgt drei Monate ab Ausstellung.' };
    out.issuedOn = issuedOn;
    out.validUntil = issueValidUntil(issuedOn);
  }
  if (f.type === 'Betriebshaftpflicht') {
    const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));
    out.insurance = { personEuros: n(personEuros), propertyEuros: n(propertyEuros), nuCovered: nuCovered === 'ja' };
  }
  if (f.type === 'Zertifikat') out.title = String(title || '').trim().slice(0, 120);
  return { doc: out };
}

const MISSING_COMPANY = ['Gewerbeanmeldung', 'Betriebshaftpflicht', 'Unbedenklichkeitsbescheinigung', 'Freistellungsbescheinigung'];
const fmt = (d) => d.split('-').reverse().join('.');

// What a firm still has to send: missing or expired company papers, a missing ID, and an A1 or its alternative.
export function missingItems(state, companyId, today, noticeDays = 14) {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) return [];
  const live = state.docs.filter((d) => d.companyId === companyId && docIsLive(d, state.docs));
  const usable = (list) => list.some((d) => !d.validUntil || expiryState(d.validUntil, today, noticeDays) !== 'expired');
  const items = [];
  for (const type of MISSING_COMPANY) {
    if (type === 'Unbedenklichkeitsbescheinigung' && company.country !== 'DE') continue;
    const mine = live.filter((d) => !d.workerId && !d.projectAgreementId && d.type === type);
    if (!mine.length) items.push({ key: `c:${type}`, scope: 'Firma', label: type });
    else if (!usable(mine)) items.push({ key: `c:${type}`, scope: 'Firma', label: `${type} (abgelaufen am ${fmt(mine[0].validUntil)})` });
  }
  for (const w of state.workers.filter((x) => x.companyId === companyId && !x.archived && !x.inactive)) {
    const name = w.name || 'Mitarbeiter ohne Namen', mine = live.filter((d) => d.workerId === w.id);
    if (!mine.some((d) => d.type === 'Ausweis')) items.push({ key: `w:${w.id}:ausweis`, scope: name, label: `Ausweis von ${name}` });
    if (!usable(mine.filter((d) => SOCIAL_TYPES.includes(d.type)))) items.push({ key: `w:${w.id}:a1`, scope: name, label: `A1-Bescheinigung oder alternativ Sozialmeldebescheinigung von ${name}` });
  }
  return items;
}

export function requestMail(company, items) {
  const body = ['Guten Tag,', '', 'für die weitere Zusammenarbeit fehlen uns noch folgende Unterlagen:', '', ...items.map((i) => '- ' + i.label), '', 'Bitte senden Sie uns diese schnellstmöglich zu.', '', 'Vielen Dank und freundliche Grüße', 'DaSo Lüftungsbau'].join('\n');
  const q = `subject=${encodeURIComponent('Fehlende Unterlagen')}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(company.email || '').replace(/%40/g, '@')}?${q}`;
}
