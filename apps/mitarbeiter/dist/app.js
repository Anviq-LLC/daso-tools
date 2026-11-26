const $ = (id) => document.getElementById(id);
const state = { me: null, tab: '', month: new Date().toISOString().slice(0, 7) };

async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  $('msg').textContent = res.ok ? '' : out.error || 'Fehler';
  return res.ok ? out : null;
}

// Small DOM helper: text is always set as text, never as HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el[k] = v;
    else if (v !== false && v !== undefined) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return el;
}
const btn = (label, onclick, primary = false) => h('button', { class: 'btn' + (primary ? ' primary' : ''), type: 'button', onclick }, label);
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('div', { class: 'cardhead' }, h('h2', { style: 'margin:0;font-size:15px' }, title)) : null, ...kids);
const pad = (...kids) => h('div', { style: 'padding:18px 21px' }, ...kids);
const table = (head, rows, empty) => h('div', { class: 'tablewrap' }, rows.length
  ? h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows))
  : h('div', { class: 'empty' }, empty));
const fmtTime = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.split('-').reverse().join('.');
const TYPE_LABEL = { vacation: 'Urlaub', unpaid: 'Unbezahlter Urlaub', sick: 'Krank', homeoffice: 'Homeoffice', other: 'Sonstiges' };
const SHORT = { vacation: 'U', unpaid: 'UU', sick: 'K', homeoffice: 'HO' };

function monthNav() {
  const shift = (n) => { const [y, m] = state.month.split('-').map(Number); state.month = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); render(); };
  return h('div', { class: 'actions', style: 'margin-bottom:14px' }, btn('‹', () => shift(-1)), h('strong', {}, state.month.split('-').reverse().join('/')), btn('›', () => shift(1)));
}

// ---- views ----
async function viewToday() {
  const me = await api('me');
  state.me = me || state.me;
  const open = me?.open;
  const report = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Was hast du gemacht?' });
  const pause = h('input', { type: 'number', min: 0, step: 5, value: 0 });
  const punches = await api('punches?month=' + new Date().toISOString().slice(0, 7));
  const list = (punches?.punches || []).map((p) => h('tr', {}, h('td', {}, fmtTime(p.started)), h('td', {}, p.ended ? fmtTime(p.ended) : 'läuft'), h('td', {}, p.pause ?? ''), h('td', { style: 'white-space:normal' }, p.report)));
  return [
    card(open ? 'Eingestempelt seit ' + fmtTime(open.started) : 'Nicht eingestempelt',
      pad(open
        ? [h('div', { class: 'formgrid' }, field('Bericht', report), field('Pause in Minuten', pause)), h('div', { class: 'actions', style: 'margin-top:14px' }, btn('Ausstempeln', async () => { if (await api('punch/out', { report: report.value, pause: Number(pause.value) })) render(); }, true))]
        : btn('Einstempeln', async () => { if (await api('punch/in', {})) render(); }, true))),
    card('Meine Zeiten (laufender Monat)', table(['Beginn', 'Ende', 'Pause (Min.)', 'Bericht'], list, 'Noch keine Einträge.')),
  ];
}

async function viewCalendar() {
  const cal = await api('calendar?month=' + state.month);
  if (!cal) return [];
  const [y, m] = state.month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => `${state.month}-${String(i + 1).padStart(2, '0')}`);
  const admin = state.me.admin;
  const emp = h('select', {}, cal.employees.map((e) => h('option', { value: e.id }, e.name)));
  const day = h('input', { type: 'date', value: days[0] });
  const type = h('select', {}, Object.entries(TYPE_LABEL).filter(([k]) => admin || ['sick', 'homeoffice', 'other'].includes(k)).map(([k, v]) => h('option', { value: k }, v)));
  const label = h('input', { maxlength: 60, placeholder: 'z. B. Seminar, Berufsschule' });
  if (!admin) emp.value = state.me.me.id;
  const save = async () => { if (await api('absence', { employeeId: emp.value, day: day.value, type: type.value, label: label.value })) render(); };
  const remove = async () => { if (await api('absence/delete', { employeeId: emp.value, day: day.value })) render(); };
  const cell = (e, d) => {
    const a = cal.days[e.id]?.[d];
    const wd = new Date(d).getUTCDay();
    const text = !a ? '' : a.type === 'away' ? '•' : a.type === 'other' ? (a.label || '?').slice(0, 4) : SHORT[a.type];
    return h('td', { title: a ? (a.type === 'away' ? 'abwesend' : (TYPE_LABEL[a.type] || '') + (a.label ? ': ' + a.label : '')) : '', style: `padding:8px 5px;text-align:center;${wd === 0 || wd === 6 ? 'background:#fafbfe;' : ''}${a ? 'background:var(--soft);color:var(--accent);font-weight:600' : ''}` }, text);
  };
  return [
    monthNav(),
    card('Bürokalender',
      table(['Mitarbeiter', ...days.map((d) => d.slice(8))], cal.employees.map((e) => h('tr', {}, h('td', {}, e.name), days.map((d) => cell(e, d)))), 'Noch keine Büromitarbeiter. Die Funktion muss „Büro“ enthalten.'),
      pad(h('p', { class: 'muted', style: 'margin:0' }, 'K = krank, U = Urlaub, UU = unbezahlter Urlaub, HO = Homeoffice. Kollegen sehen nur „•“ (abwesend), nie den Grund.'))),
    card('Eintrag setzen',
      h('div', { class: 'formgrid', style: 'padding:18px 21px;align-items:end' },
        admin ? field('Mitarbeiter', emp) : null, field('Tag', day), field('Art', type), field('Bezeichnung (bei „Sonstiges“)', label),
        h('div', { class: 'actions' }, btn('Speichern', save, true), btn('Entfernen', remove)))),
  ];
}

async function viewVacation() {
  const data = await api('vacation');
  const admin = state.me.admin;
  const start = h('input', { type: 'date' }), end = h('input', { type: 'date' }), note = h('input', { maxlength: 200 });
  const status = { pending: 'Offen', approved: 'Genehmigt', rejected: 'Abgelehnt', withdrawn: 'Zurückgezogen' };
  const rows = (data?.requests || []).map((r) => h('tr', {},
    admin ? h('td', {}, r.name) : null, h('td', {}, fmtDay(r.start_day) + ' – ' + fmtDay(r.end_day)), h('td', {}, r.note), h('td', {}, status[r.status] || r.status),
    h('td', {}, h('div', { class: 'actions' },
      r.status === 'pending' && admin ? [btn('Genehmigen', async () => { if (await api('vacation/decide', { id: r.id, approve: true })) render(); }, true), btn('Ablehnen', async () => { if (await api('vacation/decide', { id: r.id, approve: false })) render(); })] : null,
      r.status === 'pending' && !admin ? btn('Zurückziehen', async () => { if (await api('vacation/withdraw', { id: r.id })) render(); }) : null))));
  return [
    state.me.me?.office ? card('Urlaub beantragen', h('div', { class: 'formgrid', style: 'padding:18px 21px;align-items:end' }, field('Von', start), field('Bis', end), field('Notiz', note), h('div', { class: 'actions' }, btn('Beantragen', async () => { if (await api('vacation/request', { start: start.value, end: end.value, note: note.value })) render(); }, true)))) : null,
    card('Anträge', table([admin ? 'Mitarbeiter' : null, 'Zeitraum', 'Notiz', 'Status', ''].filter(Boolean), rows, 'Keine Anträge.')),
  ];
}

async function viewTimes() {
  const data = await api('punches?month=' + state.month);
  const rows = (data?.punches || []).map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, fmtTime(p.started)), h('td', {}, p.ended ? fmtTime(p.ended) : 'läuft'), h('td', {}, p.pause ?? ''), h('td', { style: 'white-space:normal' }, p.report)));
  return [monthNav(), card('Zeiten der Büromitarbeiter', table(['Mitarbeiter', 'Beginn', 'Ende', 'Pause (Min.)', 'Bericht'], rows, 'Keine Einträge in diesem Monat.'))];
}

async function viewStaff() {
  const data = await api('employees');
  if (!data) return [];
  const f = { id: h('input', { type: 'hidden' }), name: h('input', { maxlength: 100, placeholder: 'Vor- und Nachname', required: true }), role: h('input', { maxlength: 60, placeholder: 'z. B. Monteur oder Büro', list: 'roles' }), email: h('input', { type: 'email', placeholder: 'Login-E-Mail (nur für Büro)' }) };
  const title = h('h2', { style: 'margin:0;font-size:15px' }, 'Mitarbeiter hinzufügen');
  const reset = () => { for (const i of Object.values(f)) i.value = ''; title.textContent = 'Mitarbeiter hinzufügen'; };
  const rows = data.employees.map((e) => h('tr', {},
    h('td', {}, e.name), h('td', {}, e.role), h('td', {}, e.email || ''),
    h('td', {}, h('span', { class: 'pill ' + (e.archived_at ? 'amber' : 'green') }, e.archived_at ? 'Archiviert' : 'Aktiv')),
    h('td', {}, h('div', { class: 'actions' },
      btn('Bearbeiten', () => { f.id.value = e.id; f.name.value = e.name; f.role.value = e.role; f.email.value = e.email || ''; title.textContent = 'Mitarbeiter bearbeiten'; f.name.focus(); }),
      btn(e.archived_at ? 'Wiederherstellen' : 'Archivieren', async () => { if (await api('employees/archive', { id: e.id, archived: !e.archived_at })) render(); })))));
  return [
    card(null, h('div', { class: 'cardhead' },
      h('div', {}, h('strong', {}, data.master ? 'Dieses Tool ist führend.' : 'Dieses Tool ist noch nicht führend.'),
        h('p', { class: 'muted', style: 'margin:6px 0 0' }, data.master ? 'Die Einteilung übernimmt Name und Funktion von hier und legt keine Mitarbeiter mehr selbst an.' : 'Solange das aus ist, werden Mitarbeiter wie bisher in der Einteilung gepflegt. Zeiten und Abwesenheiten aus diesem Tool erreichen die Lohnabrechnung erst, wenn es führend ist.')),
      h('div', { class: 'actions' }, btn('Aus der Einteilung übernehmen', async () => { if (await api('import', {})) render(); }), btn(data.master ? 'Wieder ausschalten' : 'Als führend einschalten', async () => { if (await api('master', { on: !data.master })) render(); })))),
    card(null, h('div', { class: 'cardhead' }, title),
      h('div', { class: 'formgrid', style: 'padding:18px 21px;align-items:end' }, f.id, field('Name', f.name), field('Funktion', f.role), field('E-Mail', f.email),
        h('div', { class: 'actions' }, btn('Speichern', async () => { if (await api('employees', { id: f.id.value, name: f.name.value, role: f.role.value, email: f.email.value })) { render(); } }, true), btn('Abbrechen', reset))),
      h('datalist', { id: 'roles' }, ['Monteur', 'Obermonteur', 'Büro'].map((r) => h('option', {}, r)))),
    card(null, table(['Name', 'Funktion', 'E-Mail', 'Status', ''], rows, 'Noch keine Mitarbeiter. Mit „Aus der Einteilung übernehmen“ die vorhandenen laden.')),
  ];
}

const VIEWS = { today: ['Heute', viewToday, (s) => s.me?.office], calendar: ['Kalender', viewCalendar, () => true], vacation: ['Urlaub', viewVacation, () => true], times: ['Zeiten', viewTimes, (s) => s.admin], staff: ['Stammdaten', viewStaff, (s) => s.admin] };

async function render() {
  const available = Object.entries(VIEWS).filter(([, v]) => v[2]({ ...state.me, me: state.me?.me }));
  if (!available.some(([k]) => k === state.tab)) state.tab = available[0]?.[0] || '';
  $('tabs').replaceChildren(...available.map(([k, v]) => h('button', { class: 'navbtn' + (k === state.tab ? ' active' : ''), type: 'button', onclick: () => { state.tab = k; render(); } }, v[0])));
  $('crumb').textContent = state.tab ? '/ ' + VIEWS[state.tab][0] : '';
  const nodes = state.tab ? await VIEWS[state.tab][1]() : [];
  // Every page starts with a small label and its title, as in Aufmass and Montageplanung.
  const heading = state.tab ? h('div', { class: 'heading' }, h('div', {}, h('div', { class: 'eyebrow' }, 'DASO · MITARBEITER'), h('h1', {}, VIEWS[state.tab][0]))) : null;
  $('view').replaceChildren(...[heading, ...nodes].filter(Boolean));
}

state.me = await api('me');
if (state.me) {
  $('user').replaceChildren(state.me.email, h('small', {}, state.me.admin ? 'Planer' : 'Mitarbeiter'));
  render();
}
