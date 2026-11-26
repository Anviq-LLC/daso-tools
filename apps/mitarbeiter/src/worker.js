import { accessEmail } from './auth.js';
import { cleanEmployee, importRows } from './employees.js';
import { isOfficeRole, cleanAbsence, cleanPause, cleanVacation, workdays, validDay, TYPES, SELF_TYPES } from './office.js';

const json = (v, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => json({ error: message }, status);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthEnd = (m) => { const [y, n] = m.split('-').map(Number); return new Date(Date.UTC(y, n, 1)).toISOString(); };
const today = () => new Date().toISOString().slice(0, 10);

// Browsers always send Sec-Fetch-Site or Origin on cross-site writes.
function crossSite(request) {
  if (request.method === 'GET') return false;
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if (site) return site !== 'same-origin' && site !== 'none';
  return !!origin && origin !== new URL(request.url).origin;
}

// admin: a Planer in the Montageplanung or a listed email. self: an employee whose login email is stored here.
async function whoIs(env, email) {
  const listed = String(env.MA_ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).includes(email);
  const admin = listed || !!(await env.PLAN?.prepare("SELECT 1 AS ok FROM users WHERE lower(email) = ? AND access_role = 'planer'").bind(email).first().catch(() => null));
  const row = await env.DB.prepare('SELECT id, name, role FROM employees WHERE lower(email) = ? AND archived_at IS NULL').bind(email).first();
  return { admin, email, me: row ? { ...row, office: isOfficeRole(row.role) } : null };
}

const isMaster = async (env) => (await env.DB.prepare("SELECT value FROM settings WHERE key = 'master'").first())?.value === '1';
const view = async (env) => ({
  master: await isMaster(env),
  employees: (await env.DB.prepare('SELECT id, name, role, email, archived_at FROM employees ORDER BY archived_at IS NOT NULL, name').all()).results,
});
const openPunch = (env, id) => env.DB.prepare('SELECT id, started FROM punches WHERE employee_id = ? AND ended IS NULL').bind(id).first();

// Who an absence is for: admins pick anyone, everyone else only themselves.
async function subject(env, who, body) {
  const id = who.admin && body.employeeId ? String(body.employeeId) : who.me?.id;
  return id ? env.DB.prepare('SELECT id FROM employees WHERE id = ? AND archived_at IS NULL').bind(id).first() : null;
}

async function handle(env, who, request, path, url) {
  const get = request.method === 'GET';
  const body = get ? {} : await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const office = !!who.me?.office;
  const staff = who.admin || office;

  if (get && path === '/api/me') return json({ admin: who.admin, me: who.me, master: await isMaster(env), open: office ? await openPunch(env, who.me.id) : null });

  if (get && path === '/api/punches') {
    const month = url.searchParams.get('month') || '';
    if (!MONTH.test(month)) return fail('month=YYYY-MM erforderlich.');
    if (!staff) return fail('Kein Zugriff.', 403);
    const only = who.admin ? url.searchParams.get('employeeId') : who.me.id;
    const rows = (await env.DB.prepare(`SELECT p.id, p.employee_id, e.name, p.started, p.ended, p.pause, p.report FROM punches p JOIN employees e ON e.id = p.employee_id WHERE p.started >= ? AND p.started < ? ${only ? 'AND p.employee_id = ?' : ''} ORDER BY p.started DESC`).bind(month + '-01', monthEnd(month), ...(only ? [only] : [])).all()).results;
    return json({ punches: rows });
  }

  if (get && path === '/api/calendar') {
    const month = url.searchParams.get('month') || '';
    if (!MONTH.test(month)) return fail('month=YYYY-MM erforderlich.');
    if (!staff) return fail('Kein Zugriff.', 403);
    const people = (await env.DB.prepare('SELECT id, name, role FROM employees WHERE archived_at IS NULL ORDER BY name').all()).results.filter((e) => isOfficeRole(e.role));
    const ids = new Set(people.map((p) => p.id));
    const rows = (await env.DB.prepare('SELECT employee_id, day, type, label FROM absences WHERE day >= ? AND day < ?').bind(month + '-01', monthEnd(month).slice(0, 10)).all()).results.filter((r) => ids.has(r.employee_id));
    const days = {};
    for (const r of rows) {
      // Colleagues only learn that someone is away, never why.
      const full = who.admin || r.employee_id === who.me?.id;
      (days[r.employee_id] ||= {})[r.day] = full ? { type: r.type, label: r.label } : { type: 'away', label: '' };
    }
    return json({ month, employees: people.map((p) => ({ id: p.id, name: p.name })), days });
  }

  if (get && path === '/api/vacation') {
    if (!staff) return fail('Kein Zugriff.', 403);
    const rows = (await env.DB.prepare(`SELECT v.id, v.employee_id, e.name, v.start_day, v.end_day, v.note, v.status, v.decided_by FROM vacation_requests v JOIN employees e ON e.id = v.employee_id ${who.admin ? '' : 'WHERE v.employee_id = ?'} ORDER BY v.created_at DESC LIMIT 200`).bind(...(who.admin ? [] : [who.me.id])).all()).results;
    return json({ requests: rows });
  }

  if (path === '/api/punch/in') {
    if (!office) return fail('Nur Büromitarbeiter können einstempeln.', 403);
    try { await env.DB.prepare('INSERT INTO punches (id, employee_id, started) VALUES (?, ?, ?)').bind(crypto.randomUUID(), who.me.id, now).run(); }
    catch { return fail('Du bist bereits eingestempelt.', 409); }
    return json({ ok: true });
  }
  if (path === '/api/punch/out') {
    if (!office) return fail('Nur Büromitarbeiter können ausstempeln.', 403);
    const open = await openPunch(env, who.me.id);
    if (!open) return fail('Kein laufender Eintrag gefunden.', 409);
    const pause = cleanPause(body.pause, open.started, now);
    const done = await env.DB.prepare('UPDATE punches SET ended = ?, pause = ?, report = ? WHERE id = ? AND ended IS NULL').bind(now, pause, String(body.report ?? '').trim().slice(0, 2000), open.id).run();
    return done.meta.changes ? json({ ok: true }) : fail('Bereits ausgestempelt. Bitte neu laden.', 409);
  }
  if (path === '/api/punch/edit') {
    if (!who.admin) return fail('Kein Zugriff.', 403);
    const { id, started, ended } = body;
    if (!(Date.parse(started) < Date.parse(ended))) return fail('Beginn und Ende sind ungültig.');
    const pause = cleanPause(body.pause, started, ended);
    const done = await env.DB.prepare('UPDATE punches SET started = ?, ended = ?, pause = ?, report = ? WHERE id = ?').bind(new Date(started).toISOString(), new Date(ended).toISOString(), pause, String(body.report ?? '').trim().slice(0, 2000), String(id || '')).run();
    return done.meta.changes ? json({ ok: true }) : fail('Eintrag nicht gefunden.', 404);
  }

  if (path === '/api/absence' || path === '/api/absence/delete') {
    const who2 = staff ? await subject(env, who, body) : null;
    if (!who2) return fail('Kein Zugriff.', 403);
    const allowed = who.admin ? TYPES : SELF_TYPES;
    if (path === '/api/absence') {
      const a = cleanAbsence(body, allowed);
      const existing = await env.DB.prepare('SELECT type FROM absences WHERE employee_id = ? AND day = ?').bind(who2.id, a.day).first();
      if (existing && !allowed.includes(existing.type)) return fail('Diesen Eintrag kann nur ein Planer ändern.', 403);
      await env.DB.prepare('INSERT OR REPLACE INTO absences (employee_id, day, type, label, created_by) VALUES (?, ?, ?, ?, ?)').bind(who2.id, a.day, a.type, a.label, who.email).run();
    } else {
      if (!validDay(body.day)) return fail('Bitte ein gültiges Datum angeben.');
      const existing = await env.DB.prepare('SELECT type FROM absences WHERE employee_id = ? AND day = ?').bind(who2.id, body.day).first();
      if (existing && !allowed.includes(existing.type)) return fail('Diesen Eintrag kann nur ein Planer ändern.', 403);
      await env.DB.prepare('DELETE FROM absences WHERE employee_id = ? AND day = ?').bind(who2.id, body.day).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/vacation/request') {
    if (!office) return fail('Nur Büromitarbeiter können Urlaub beantragen.', 403);
    const clash = await env.DB.prepare("SELECT 1 AS n FROM vacation_requests WHERE employee_id = ? AND status IN ('pending', 'approved') AND start_day <= ? AND end_day >= ?").bind(who.me.id, String(body.end), String(body.start)).first();
    const v = cleanVacation(body, today(), !!clash);
    await env.DB.prepare('INSERT INTO vacation_requests (id, employee_id, start_day, end_day, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), who.me.id, v.start, v.end, v.note, now).run();
    return json({ ok: true });
  }
  if (path === '/api/vacation/withdraw') {
    if (!office) return fail('Kein Zugriff.', 403);
    const done = await env.DB.prepare("UPDATE vacation_requests SET status = 'withdrawn', decided_at = ? WHERE id = ? AND employee_id = ? AND status = 'pending'").bind(now, String(body.id || ''), who.me.id).run();
    return done.meta.changes ? json({ ok: true }) : fail('Der Antrag ist nicht mehr offen.', 409);
  }
  if (path === '/api/vacation/decide') {
    if (!who.admin) return fail('Kein Zugriff.', 403);
    const req = await env.DB.prepare('SELECT * FROM vacation_requests WHERE id = ?').bind(String(body.id || '')).first();
    if (!req || req.status !== 'pending') return fail('Der Antrag ist nicht mehr offen.', 409);
    const done = await env.DB.prepare("UPDATE vacation_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").bind(body.approve ? 'approved' : 'rejected', now, who.email, req.id).run();
    if (!done.meta.changes) return fail('Der Antrag ist nicht mehr offen.', 409);
    if (body.approve) await env.DB.batch(workdays(req.start_day, req.end_day).map((day) => env.DB.prepare("INSERT OR REPLACE INTO absences (employee_id, day, type, label, created_by) VALUES (?, ?, 'vacation', '', ?)").bind(req.employee_id, day, who.email)));
    return json({ ok: true });
  }

  // Master data and the switch are for admins only.
  if (!who.admin) return fail('Kein Zugriff.', 403);
  if (get && path === '/api/employees') return json(await view(env));
  if (path === '/api/employees') {
    const e = cleanEmployee(body);
    try {
      if (e.id) {
        const done = await env.DB.prepare('UPDATE employees SET name = ?, role = ?, email = ?, updated_at = ? WHERE id = ?').bind(e.name, e.role, e.email, now, e.id).run();
        if (!done.meta.changes) return fail('Mitarbeiter nicht gefunden.', 404);
      } else {
        await env.DB.prepare('INSERT INTO employees (id, name, role, email, updated_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), e.name, e.role, e.email, now).run();
      }
    } catch { return fail('Diese E-Mail-Adresse gehört schon zu einem Mitarbeiter.', 409); }
    return json(await view(env));
  }
  if (path === '/api/employees/archive') {
    await env.DB.prepare('UPDATE employees SET archived_at = ?, updated_at = ? WHERE id = ?').bind(body.archived ? now : null, now, String(body.id || '')).run();
    return json(await view(env));
  }
  if (path === '/api/import') {
    const plan = (await env.PLAN.prepare("SELECT id, name, role, archived_at FROM resources WHERE kind = 'employee'").all()).results;
    const have = (await env.DB.prepare('SELECT id FROM employees').all()).results.map((r) => r.id);
    const rows = importRows(plan, have);
    if (rows.length) await env.DB.batch(rows.map((r) => env.DB.prepare('INSERT INTO employees (id, name, role, archived_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(r.id, r.name, r.role, r.archived_at, now)));
    return json({ ...(await view(env)), imported: rows.length });
  }
  if (path === '/api/master') {
    if (body.on && !(await env.DB.prepare('SELECT 1 AS n FROM employees LIMIT 1').first())) return fail('Bitte zuerst die Mitarbeiter aus der Einteilung übernehmen.');
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('master', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.on ? '1' : '0').run();
    return json(await view(env));
  }
  return fail('Nicht gefunden.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    let email = await accessEmail(request, env);
    if (!email && env.DEV_IDENTITY === '1') email = 'dev@localhost';
    if (!email) return new Response('Bitte anmelden.', { status: 401 });
    const who = await whoIs(env, email);
    if (env.DEV_IDENTITY === '1' && email === 'dev@localhost') who.admin = true;
    if (!who.admin && !who.me) return new Response('Kein Zugriff.', { status: 403 });
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (crossSite(request)) return fail('Anfrage von einer fremden Seite abgelehnt.', 403);
    try { return await handle(env, who, request, path, url); }
    catch (e) { return fail(e instanceof Error ? e.message : 'Fehler.'); }
  },
};
