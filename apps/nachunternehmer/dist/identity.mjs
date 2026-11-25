// Person data from identity documents and duplicate detection across companies.

const W = [7, 3, 1];
const val = (c) => (c === '<' ? 0 : c >= 'A' ? c.charCodeAt(0) - 55 : Number(c));
const check = (s) => [...s].reduce((n, c, i) => n + val(c) * W[i % 3], 0) % 10;
const ok = (field, digit) => /^\d$/.test(digit) && check(field) === Number(digit);

// OCR confuses letters and digits; fix them by field type.
const toDigits = (s) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8');
const clean = (l) => l.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');

function iso(yymmdd, kind) {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = Number(yymmdd.slice(0, 2)), now = new Date().getFullYear() % 100;
  const year = kind === 'birth' ? (yy > now ? 1900 + yy : 2000 + yy) : 2000 + yy;
  const m = yymmdd.slice(2, 4), d = yymmdd.slice(4, 6);
  return Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${year}-${m}-${d}` : '';
}

function names(field) {
  const [last, rest = ''] = field.replace(/<+$/, '').split('<<');
  const join = (s) => s.split('<').filter(Boolean).join(' ');
  return { last: join(last), first: join(rest) };
}

function build(f, valid) {
  const { last, first } = names(f.names);
  return { name: [first, last].filter(Boolean).join(' '), birth: iso(f.birth, 'birth'), validUntil: iso(f.expiry, 'expiry'), docNo: f.docNo.replace(/</g, ''), source: 'mrz', verified: valid };
}

function td1(l) {
  const [a, b, c] = l.map((x) => x.padEnd(30, '<'));
  const birth = toDigits(b.slice(0, 6)), expiry = toDigits(b.slice(8, 14));
  const valid = ok(a.slice(5, 14), a[14]) && ok(birth, toDigits(b[6])) && ok(expiry, toDigits(b[14])) &&
    ok(a.slice(5, 30) + toDigits(b.slice(0, 7)) + toDigits(b.slice(8, 15)) + b.slice(18, 29), toDigits(b[29]));
  return build({ docNo: a.slice(5, 14), birth, expiry, names: c }, valid);
}

function td3(l) {
  const [a, b] = l.map((x) => x.padEnd(44, '<'));
  const birth = toDigits(b.slice(13, 19)), expiry = toDigits(b.slice(21, 27));
  const valid = ok(b.slice(0, 9), b[9]) && ok(birth, toDigits(b[19])) && ok(expiry, toDigits(b[27])) &&
    ok(b.slice(0, 10) + toDigits(b.slice(13, 20)) + toDigits(b.slice(21, 28)) + b.slice(28, 43), toDigits(b[43]));
  return build({ docNo: b.slice(0, 9), birth, expiry, names: a.slice(5) }, valid);
}

export function parseMrz(text) {
  const lines = text.split('\n').map(clean).filter((l) => l.length >= 28 && l.includes('<'));
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length <= 33 && lines[i + 2] && lines[i + 1].length <= 33 && lines[i + 2].length <= 33) return td1(lines.slice(i, i + 3));
    if (lines[i].length >= 40 && lines[i + 1]?.length >= 40) return td3(lines.slice(i, i + 2));
  }
  return null;
}

// Value sits after the label or, on bilingual ID cards, on the next line.
const label = (text, names) => {
  const m = text.match(new RegExp(`(?:${names})[^\\S\\n]*([^\\n]*)(?:\\n\\s*)?([^\\n]*)`, 'i'));
  if (!m) return '';
  const rest = m[1].replace(/^\s*[:/]?\s*(?:(?:Surname|Last name|Given names?|Forenames?|First names?|Date of birth)\b)?\s*[:/]?\s*/i, '').trim();
  return (rest.length >= 2 ? rest : m[2].trim());
};
const de = (s) => { const m = s.match(/(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };

// Printed labels (A1 certificate, insurance, front of an ID card). Only suggestions.
export function parseLabels(text) {
  const last = label(text, 'Nazwisko|Surname|Last name|Nachname|Familienname|Name\\s*/\\s*Surname').split(/\s{2,}/)[0];
  const first = label(text, 'Imi[ęe]\\s*\\(?i?m?i?e?n?a?\\)?|Imiona|Forenames?|First names?|Given names?|Vornamen?').split(/\s{2,}/)[0];
  const birth = de(label(text, 'Data urodzenia|Date of birth|Geburtsdatum|geboren am'));
  if (!last && !first) return null;
  return { name: [first, last].filter(Boolean).join(' '), birth, validUntil: '', docNo: '', source: 'text', verified: false };
}

export function readIdentity(text) {
  return parseMrz(text) || parseLabels(text);
}

const MAP = { 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th' };
export function nameKey(name) {
  const s = String(name || '').toLowerCase().replace(/[łøđßæœðþ]/g, (c) => MAP[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return s.split(/[^a-z]+/).filter(Boolean).sort().join(' ');
}

// Other people in the data who are probably the same person.
export function findMatches(state, worker) {
  const idn = worker.identity || {};
  const docNo = String(idn.docNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nk = nameKey(worker.name);
  const company = (id) => state.companies.find((c) => c.id === id)?.name || '';
  const out = [];
  for (const o of state.workers) {
    if (o.id === worker.id) continue;
    const oi = o.identity || {}, ok2 = nameKey(o.name) === nk && nk;
    const sameDoc = docNo && docNo === String(oi.docNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sameBirth = idn.birth && oi.birth && idn.birth === oi.birth;
    const level = sameDoc || (ok2 && sameBirth) ? 'sicher' : ok2 && !(idn.birth && oi.birth) ? 'name' : '';
    if (level) out.push({ id: o.id, name: o.name, company: company(o.companyId), sameCompany: o.companyId === worker.companyId, level });
  }
  return out;
}
