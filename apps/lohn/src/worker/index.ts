import { fullMonth, type DateRange, type NuPeriods } from '../calc/nu-periods.ts';
import { HttpError, identify, type Env, type Identity } from './auth.ts';
import { liveMonth, loadSettings, prevMonth, termsFor, sameGroup, DEFAULT_TERMS } from './month.ts';
import type { MonthResult, Terms } from '../calc/month.ts';
import { toCsv } from './export.ts';
import { KEYS, MONTHLY_PAYROLL_HOURS, MONTHLY_REVENUE_BONUS, OTHER_PAYMENT_LABEL, PAYROLL_ABSENCE_NOTES } from '../calc/payroll.ts';
import { databaseSources, type PayrollSources } from './sources.ts';
import { loadSubBonus, subBonusWeeks, subTermsFor } from './sub-bonus.ts';
import { activePayrollEmployee, annualAllowances, manualPayrollEmployees, payrollInputChange } from './payroll.ts';

const SECURITY = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};
const reply = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...SECURITY, ...extra } });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = (s: string) => { if (!MONTH.test(s)) throw new HttpError(400, 'Ungültiger Monat.'); return s; };
const cents = (v: unknown) => { if (!Number.isSafeInteger(v)) throw new HttpError(400, 'Betrag muss in Cent angegeben werden.'); return v as number; };
function monthlyHours(value: unknown, rate: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(rate * value)) {
    throw new HttpError(400, 'Bitte gültige Monatsstunden ab 0 eingeben.');
  }
  return value;
}
const text = (v: unknown, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, 'Ungültiger Text.'); return v.trim(); };
const STATES = ['offen', 'pruefung', 'freigabe', 'freigegeben', 'abgeschlossen'] as const;

async function log(env: Env, who: Identity, action: string, detail = '') {
  await env.DB.prepare('INSERT INTO audit (id, at, actor, action, detail) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), new Date().toISOString(), who.email, action, detail).run();
}

async function monthState(env: Env, m: string) {
  const row = await env.DB.prepare('SELECT status, snapshot, released_by, released_at, updated_at FROM months WHERE month = ?').bind(m)
    .first<{ status: string; snapshot: string | null; released_by: string | null; released_at: string | null; updated_at: string }>();
  return row ?? { status: 'offen', snapshot: null, released_by: null, released_at: null, updated_at: null };
}
const closed = (s: string) => s === 'freigegeben' || s === 'abgeschlossen';
async function assertOpen(env: Env, m: string) {
  if (closed((await monthState(env, m)).status)) throw new HttpError(409, 'Der Monat ist freigegeben und schreibgeschützt.');
}

async function route(request: Request, env: Env, url: URL, authenticate: typeof identify, sources: PayrollSources): Promise<Response> {
  const who = await authenticate(request, env);
  const p = url.pathname, method = request.method;
  const body = async <T = Record<string, unknown>>() => {
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'JSON erwartet.');
    return (await request.json()) as T;
  };
  // Browsers send Origin on cross-site writes; refuse anything not from this site.
  if (method !== 'GET') {
    const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
    if ((site && site !== 'same-origin') || (origin && origin !== url.origin)) throw new HttpError(403, 'Fremde Anfrage abgelehnt.');
  }

  if (p === '/api/me') return reply({ email: who.email, role: who.role });

  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/api\/months\/([\d-]+)$/)) && method === 'GET') {
    const mo = month(m[1]);
    const st = await monthState(env, mo);
    if (closed(st.status) && st.snapshot) return reply({ ...JSON.parse(st.snapshot), status: st.status, releasedBy: st.released_by, releasedAt: st.released_at, frozen: true });
    const live = await liveMonth(env, mo, sources);
    return reply({ result: live.result, unchecked: live.unchecked, status: st.status, frozen: false });
  }
  if ((m = p.match(/^\/api\/months\/([\d-]+)\/status$/)) && method === 'POST') {
    const mo = month(m[1]);
    const b = await body<{ to: string; ack?: boolean; reason?: string }>();
    const st = await monthState(env, mo);
    const from = STATES.indexOf(st.status as (typeof STATES)[number]), to = STATES.indexOf(b.to as (typeof STATES)[number]);
    if (to < 0) throw new HttpError(400, 'Unbekannter Status.');
    const now = new Date().toISOString();
    const current = [mo, st.status, st.updated_at] as const;
    const sameMonthState = 'month = ? AND status = ? AND updated_at = ?';
    if (to === from + 1 && to <= 2) {
      await env.DB.prepare('INSERT INTO months (month, status, updated_at) VALUES (?,?,?) ON CONFLICT(month) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(mo, b.to, now).run();
    } else if (to === 3 && from === 2) {
      const live = await liveMonth(env, mo, sources);
      const snapshot = JSON.stringify({ result: live.result, unchecked: live.unchecked, warnings: live.result.warnings });
      const stmts: D1PreparedStatement[] = [];
      for (const r of live.result.rows) {
        const inst = r.lines.find((l) => l.code === 'WZG');
        if (inst) stmts.push(env.DB.prepare(`UPDATE tool_accounts SET paid_before_cents = paid_before_cents - ? WHERE resource_id = ?
          AND EXISTS (SELECT 1 FROM months WHERE ${sameMonthState})`).bind(inst.cents, r.resourceId, ...current));
      }
      stmts.push(env.DB.prepare(`UPDATE months SET status = 'freigegeben', snapshot = ?, released_by = ?, released_at = ?, updated_at = ?
        WHERE ${sameMonthState}`).bind(snapshot, who.email, now, now, ...current));
      const results = await env.DB.batch(stmts);
      if (!results.at(-1)?.meta.changes) throw new HttpError(409, 'Der Monatsstatus wurde inzwischen geändert.');
    } else if (to === 4 && from === 3) {
      const result = await env.DB.prepare(`UPDATE months SET status = 'abgeschlossen', updated_at = ? WHERE ${sameMonthState}`)
        .bind(now, ...current).run();
      if (!result.meta.changes) throw new HttpError(409, 'Der Monatsstatus wurde inzwischen geändert.');
    } else if (b.to === 'pruefung' && closed(st.status)) {
      if (who.role !== 'gf') throw new HttpError(403, 'Nur die Geschäftsführung kann eine Abrechnung erneut bearbeiten.');
      if (typeof b.reason !== 'string' || !b.reason.trim() || b.reason.length > 300) {
        throw new HttpError(400, 'Bitte einen Grund für die Korrektur angeben.');
      }
      const reason = b.reason.trim();
      const stmts = [
        env.DB.prepare(`INSERT INTO payroll_revisions (id, month, status, snapshot, inputs, released_by, released_at, reopened_by, reopened_at, reason)
          SELECT ?, month, status, snapshot, (SELECT json_group_object(resource_id, json(data)) FROM payroll_inputs WHERE month = ?),
            released_by, released_at, ?, ?, ? FROM months WHERE ${sameMonthState} AND snapshot IS NOT NULL`)
          .bind(crypto.randomUUID(), mo, who.email, now, reason, ...current),
        env.DB.prepare(`INSERT INTO audit (id, at, actor, action, detail) SELECT ?, ?, ?, ?, ? FROM months WHERE ${sameMonthState}`)
          .bind(crypto.randomUUID(), now, who.email, 'Freigabe zurückgenommen', `${mo}: ${reason}`, ...current),
      ];
      if (st.snapshot) for (const r of (JSON.parse(st.snapshot) as { result: MonthResult }).result.rows) {
        const inst = r.lines.find((l) => l.code === 'WZG');
        if (inst) stmts.push(env.DB.prepare(`UPDATE tool_accounts SET paid_before_cents = MAX(0, paid_before_cents + ?) WHERE resource_id = ?
          AND EXISTS (SELECT 1 FROM months WHERE ${sameMonthState})`).bind(inst.cents, r.resourceId, ...current));
      }
      stmts.push(env.DB.prepare(`UPDATE months SET status = 'pruefung', released_by = NULL, released_at = NULL, updated_at = ?
        WHERE ${sameMonthState}`).bind(now, ...current));
      const results = await env.DB.batch(stmts);
      if (!results.at(-1)?.meta.changes) throw new HttpError(409, 'Der Monatsstatus wurde inzwischen geändert.');
      return reply({ ok: true });
    } else throw new HttpError(409, 'Dieser Statuswechsel ist nicht erlaubt.');
    await log(env, who, 'Status ' + b.to, mo);
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/months\/([\d-]+)\/export\.csv$/)) && method === 'GET') {
    const mo = month(m[1]);
    const st = await monthState(env, mo);
    if (!closed(st.status) || !st.snapshot) throw new HttpError(409, 'Export erst nach Freigabe möglich.');
    await log(env, who, 'Export', mo);
    return new Response(toCsv(mo, (JSON.parse(st.snapshot) as { result: MonthResult }).result), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="lohn-${mo}.csv"`, ...SECURITY },
    });
  }

  if ((m = p.match(/^\/api\/sub-bonus\/([\d-]+)\/([^/]+)$/))) {
    const currentMonth = month(m[1]);
    const resourceId = text(decodeURIComponent(m[2]), 80);
    if (method === 'GET') return reply(await loadSubBonus(env, sources, currentMonth, resourceId));
    if (method === 'PUT') {
      const period = prevMonth(currentMonth);
      const b = await body<{ item: string; cents: number }>();
      const amount = cents(b.cents);
      if (amount < 0) throw new HttpError(400, 'Bitte einen Betrag ab 0,00 € eingeben.');
      if (b.item !== 'prior-bonus' && b.item !== 'bonus' && !subBonusWeeks(period).some(week => b.item === `week:${week}`)) {
        throw new HttpError(400, 'Dieses Betragsfeld gehört nicht zum Bonusmonat.');
      }
      await assertOpen(env, currentMonth);
      await subTermsFor(env, currentMonth, resourceId);
      await env.DB.prepare('INSERT INTO sub_bonus_amounts (month, resource_id, item, cents) VALUES (?,?,?,?) ON CONFLICT(month, resource_id, item) DO UPDATE SET cents = excluded.cents')
        .bind(b.item.startsWith('week:') ? '' : period, resourceId, b.item, amount).run();
      await log(env, who, 'SUB-Monatsbonus', `${period} ${resourceId} ${b.item}`);
      return reply({ ok: true });
    }
  }

  if (p === '/api/settings') {
    if (method === 'GET') return reply(await loadSettings(env));
    if (method === 'PUT') {
      const b = await body<Record<string, unknown>>();
      const allowed = ['rates', 'tiers', 'holidays', 'absenceThreshold', 'saturdayRate', 'nightPct', 'sundayPct', 'holidayPct', 'equalSplit'];
      const stmts = Object.entries(b).filter(([k]) => allowed.includes(k)).map(([k, v]) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)));
      if (stmts.length) await env.DB.batch(stmts);
      await log(env, who, 'Einstellungen geändert', Object.keys(b).join(', '));
      return reply({ ok: true });
    }
  }
  if (p === '/api/terms') {
    if (method === 'GET') {
      const selected = url.searchParams.get('month') ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format().slice(0, 7);
      const period = month(selected);
      const [planned, local] = await Promise.all([sources.employees(), manualPayrollEmployees(env)]);
      const includeRemoved = url.searchParams.get('includeRemoved') === 'true';
      const localById = new Map(local.map(person => [person.id, person]));
      const emp = [...planned, ...local.filter(person =>
        activePayrollEmployee(person, period) || (includeRemoved && person.removed_from_month !== null && person.removed_from_month <= period))];
      const [{ terms, groupSince }, scheduled, storedHours] = await Promise.all([
        termsFor(env, period, Object.fromEntries(emp.map(e => [e.id, e.name]))),
        env.DB.prepare('SELECT resource_id, valid_from, data FROM employee_terms WHERE valid_from > ? ORDER BY valid_from')
          .bind(period + '-31').all<{ resource_id: string; valid_from: string; data: string }>(),
        env.DB.prepare('SELECT resource_id, json_extract(data, ?) AS hours FROM payroll_inputs WHERE month = ?')
          .bind('$.' + MONTHLY_PAYROLL_HOURS, period).all<{ resource_id: string; hours: number | null }>(),
      ]);
      const hoursByPerson = new Map(storedHours.results.map(row => [row.resource_id, row.hours]));
      return reply(emp.map(e => {
        const next = scheduled.results.find(row => row.resource_id === e.id && !sameGroup(terms[e.id], JSON.parse(row.data)));
        const group = next ? JSON.parse(next.data) : null;
        const manual = localById.get(e.id);
        return { id: e.id, role: e.role, ...terms[e.id], manual: !!manual,
          removedFromMonth: manual?.removed_from_month ?? null, monthlyHoursHundredths: hoursByPerson.get(e.id) ?? null, groupSince: groupSince[e.id] ?? null,
          nextGroup: next ? { from: next.valid_from, group: group.lohngruppe ?? null, sub: !!group.sub } : null };
      }));
    }
    if (method === 'PUT' || method === 'PATCH') {
      const b = await body<{ resourceId: string; validFrom: string; terms: Record<string, unknown> }>();
      const date = new Date(b.validFrom + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.validFrom) || Number.isNaN(+date) || !date.toISOString().startsWith(b.validFrom)) {
        throw new HttpError(400, 'Bitte ein gültiges Gültig-ab-Datum angeben.');
      }
      const period = month(b.validFrom.slice(0, 7));
      if (closed((await monthState(env, period)).status)) throw new HttpError(409, 'Der Monat ist freigegeben. Änderungen gelten nur ab einem offenen Monat.');
      const resourceId = text(b.resourceId, 80);
      const d = DEFAULT_TERMS('');
      const current = method === 'PATCH' ? (await termsFor(env, period, { [resourceId]: '' }, b.validFrom)).terms[resourceId] : d;
      const t = method === 'PATCH' ? { ...current, ...b.terms } : b.terms;
      const lohngruppe = t.lohngruppe;
      if (lohngruppe !== null && (typeof lohngruppe !== 'number' || !Number.isInteger(lohngruppe) || lohngruppe < 1 || lohngruppe > 9)) {
        throw new HttpError(400, 'Lohngruppe 1 bis 9.');
      }
      const clean = {
        lohngruppe,
        surchargeCents: cents(t.surchargeCents ?? d.surchargeCents), foreman: !!t.foreman,
        foremanCostCents: t.foremanCostCents === null || t.foremanCostCents === undefined ? null : cents(t.foremanCostCents),
        fixedSalaryCents: t.fixedSalaryCents === null || t.fixedSalaryCents === undefined ? null : cents(t.fixedSalaryCents),
        bonus: !!t.bonus, saturday: !!t.saturday,
        sub: !!t.sub, subRateCents: t.subRateCents === null || t.subRateCents === undefined ? null : cents(t.subRateCents),
      };
      if (clean.sub && clean.subRateCents === null) throw new HttpError(400, 'SUB braucht einen Stundensatz.');
      const statements = [env.DB.prepare('INSERT INTO employee_terms (resource_id, valid_from, data) VALUES (?,?,?) ON CONFLICT(resource_id, valid_from) DO UPDATE SET data = excluded.data')
        .bind(resourceId, b.validFrom, JSON.stringify(clean))];
      if (method === 'PATCH' && !sameGroup(current, clean)) {
        // Carry the group over later entries that only changed other conditions.
        const later = (await env.DB.prepare('SELECT valid_from, data FROM employee_terms WHERE resource_id = ? AND valid_from > ? ORDER BY valid_from')
          .bind(resourceId, b.validFrom).all<{ valid_from: string; data: string }>()).results;
        for (const row of later) {
          const saved = JSON.parse(row.data) as Partial<Terms>;
          if (!sameGroup(current, saved)) break;
          const data = { ...saved, lohngruppe: clean.lohngruppe, sub: clean.sub, subRateCents: clean.subRateCents };
          statements.push(env.DB.prepare('UPDATE employee_terms SET data = ? WHERE resource_id = ? AND valid_from = ? AND data = ?')
            .bind(JSON.stringify(data), resourceId, row.valid_from, row.data));
        }
      }
      await env.DB.batch(statements);
      await log(env, who, 'Konditionen geändert', `${resourceId} ab ${b.validFrom}`);
      return reply({ ok: true });
    }
  }
  if (p === '/api/bonus-correction' && method === 'PUT') {
    const b = await body<{ month: string; resourceId: string; cents: number }>();
    const period = month(b.month);
    const resourceId = text(b.resourceId, 80);
    const amount = cents(b.cents);
    await assertOpen(env, period);
    const { terms } = await termsFor(env, period, { [resourceId]: '' });
    if (terms[resourceId].sub) throw new HttpError(400, 'Bonuskorrekturen sind nur für Mitarbeiter verfügbar.');
    const id = `bonus-correction:${period}:${resourceId}`;
    // Preserve earlier entries and store only the difference to the desired monthly total.
    const correction = env.DB.prepare(`INSERT INTO adjustments (id, month, resource_id, kind, label, cents, created_by, created_at)
      SELECT ?, ?, ?, 'korrektur', 'Bonuskorrektur Vormonat', ? - COALESCE(SUM(cents), 0), ?, ?
      FROM adjustments WHERE month = ? AND resource_id = ? AND kind = 'korrektur' AND id <> ?
      ON CONFLICT(id) DO UPDATE SET cents = excluded.cents, created_by = excluded.created_by, created_at = excluded.created_at`)
      .bind(id, period, resourceId, amount, who.email, new Date().toISOString(), period, resourceId, id);
    await env.DB.batch([
      correction,
      env.DB.prepare('DELETE FROM adjustments WHERE id = ? AND cents = 0').bind(id),
      env.DB.prepare('UPDATE payroll_inputs SET data = json_remove(data, ?) WHERE month = ? AND resource_id = ?')
        .bind('$.' + MONTHLY_REVENUE_BONUS, period, resourceId),
    ]);
    await log(env, who, 'Bonuskorrektur Vormonat', `${period} ${resourceId} ${amount}`);
    return reply({ ok: true });
  }
  if (p === '/api/adjustments' && method === 'POST') {
    const b = await body<{ month: string; resourceId: string; kind: string; label: string; cents: number }>();
    const period = month(b.month);
    const resourceId = text(b.resourceId, 80);
    await assertOpen(env, period);
    const { terms } = await termsFor(env, period, { [resourceId]: '' });
    if (terms[resourceId].sub) throw new HttpError(400, 'Lohnanpassungen sind nur für Mitarbeiter verfügbar.');
    const kind = ['korrektur', 'praemie', 'auslagen', 'notfall', 'sonstiges'].includes(b.kind) ? b.kind : (() => { throw new HttpError(400, 'Unbekannte Lohnart.'); })();
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO adjustments (id, month, resource_id, kind, label, cents, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, period, resourceId, kind, text(b.label), cents(b.cents), who.email, new Date().toISOString()).run();
    await log(env, who, 'Korrektur', `${b.month} ${b.resourceId} ${b.label} ${b.cents}`);
    return reply({ id });
  }
  if ((m = p.match(/^\/api\/adjustments\/([\w-]+)$/)) && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT month FROM adjustments WHERE id = ?').bind(m[1]).first<{ month: string }>();
    if (!row) throw new HttpError(404, 'Nicht gefunden.');
    await assertOpen(env, row.month);
    await env.DB.prepare('DELETE FROM adjustments WHERE id = ?').bind(m[1]).run();
    await log(env, who, 'Korrektur gelöscht', m[1]);
    return reply({ ok: true });
  }
  if (p === '/api/tools') {
    if (method === 'GET') return reply((await env.DB.prepare('SELECT * FROM tool_accounts').all()).results);
    if (method === 'PATCH') {
      const b = await body<{ resourceId: string; ownTools: boolean }>();
      const resourceId = text(b.resourceId, 80);
      if (typeof b.ownTools !== 'boolean') throw new HttpError(400, 'Bitte den Werkzeugstatus angeben.');
      await env.DB.prepare(`INSERT INTO tool_accounts (resource_id, price_cents, monthly_rate_cents, own_tools) VALUES (?, 0, 0, ?)
        ON CONFLICT(resource_id) DO UPDATE SET own_tools = excluded.own_tools`).bind(resourceId, Number(b.ownTools)).run();
      await log(env, who, 'Eigenes Werkzeug', resourceId + (b.ownTools ? ' · ja' : ' · nein'));
      return reply({ ok: true });
    }
    if (method === 'PUT') {
      const b = await body<{ resourceId: string; priceCents: number; monthlyRateCents: number; prepaidCents: number }>();
      await env.DB.prepare('INSERT INTO tool_accounts (resource_id, price_cents, monthly_rate_cents, prepaid_cents) VALUES (?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET price_cents = excluded.price_cents, monthly_rate_cents = excluded.monthly_rate_cents, prepaid_cents = excluded.prepaid_cents').bind(text(b.resourceId, 80), cents(b.priceCents), cents(b.monthlyRateCents), cents(b.prepaidCents ?? 0)).run();
      await log(env, who, 'Werkzeugkonto', b.resourceId);
      return reply({ ok: true });
    }
  }
  if (p === '/api/nu-costs' && method === 'PUT') {
    const b = await body<{ month: string; projectId: string; cents: number }>();
    await assertOpen(env, month(b.month));
    await env.DB.prepare('INSERT INTO nu_costs (project_id, month, cents) VALUES (?,?,?) ON CONFLICT(project_id, month) DO UPDATE SET cents = excluded.cents').bind(text(b.projectId, 80), b.month, cents(b.cents)).run();
    return reply({ ok: true });
  }
  if (p === '/api/nu-assign' && method === 'PUT') {
    const b = await body<{ month: string; projectId: string; firstId: string | null; secondId: string | null; periods?: NuPeriods }>();
    const period = month(b.month);
    await assertOpen(env, period);
    const first = b.firstId ? text(b.firstId, 80) : null, second = b.secondId ? text(b.secondId, 80) : null;
    if (second && !first) throw new HttpError(400, 'Bitte zuerst den ersten Mitarbeiter auswählen.');
    if (first && first === second) throw new HttpError(400, 'Bitte zwei unterschiedliche Mitarbeiter auswählen.');
    const full = fullMonth(period);
    function validRange(range: DateRange | undefined) {
      const day = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        value >= full.from && value <= full.to && new Date(value + 'T12:00:00Z').toISOString().startsWith(value);
      return range && day(range.from) && day(range.to) && range.from <= range.to;
    }
    const periods = b.periods ?? { first: full, second: full };
    if (second && (!validRange(periods.first) || !validRange(periods.second)))
      throw new HttpError(400, 'Bitte gültige Beteiligungszeiträume innerhalb des gewählten Monats angeben.');
    await env.DB.prepare('INSERT INTO nu_assign (project_id, month, first_id, second_id, second_pct, periods) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id, month) DO UPDATE SET first_id = excluded.first_id, second_id = excluded.second_id, second_pct = excluded.second_pct, periods = excluded.periods')
      .bind(text(b.projectId, 80), period, first, second, second ? 50 : 0, second ? JSON.stringify(periods) : null).run();
    await log(env, who, 'NU-Bonus Zuordnung', `${b.month} ${b.projectId}`);
    return reply({ ok: true });
  }
  if (p === '/api/payroll/employees' && method === 'PATCH') {
    const b = await body<{ resourceId: string; fromMonth: string; action: 'remove' | 'restore' }>();
    const selected = month(b.fromMonth);
    const id = text(b.resourceId, 80);
    if (b.action !== 'remove' && b.action !== 'restore') throw new HttpError(400, 'Unbekannte Aktion.');
    const person = (await manualPayrollEmployees(env)).find(employee => employee.id === id);
    if (!person) throw new HttpError(404, 'Diese Person wurde in der Einsatzplanung geführt oder ist unbekannt.');
    const restoring = b.action === 'restore';
    const cutoff = restoring ? person.removed_from_month : selected;
    if (!cutoff || (!restoring && !activePayrollEmployee(person, cutoff))) {
      throw new HttpError(409, 'Die Person steht für diese Änderung nicht zur Verfügung.');
    }
    await assertOpen(env, cutoff);
    if (!restoring) {
      const locked = await env.DB.prepare(`SELECT m.month FROM months AS m, json_each(m.snapshot, '$.result.rows') AS row
        WHERE m.month >= ? AND m.status IN ('freigegeben', 'abgeschlossen') AND json_extract(row.value, '$.resourceId') = ?
        ORDER BY m.month DESC LIMIT 1`).bind(cutoff, id).first<{ month: string }>();
      if (locked) throw new HttpError(409, `Die Person steht noch in der freigegebenen Abrechnung ${locked.month}. Wähle einen späteren Monat.`);
    }
    const changed = await env.DB.prepare(`UPDATE payroll_employees SET removed_from_month = ? WHERE id = ? AND removed_from_month IS ?
      AND NOT EXISTS (SELECT 1 FROM months WHERE month = ? AND status IN ('freigegeben', 'abgeschlossen'))`)
      .bind(restoring ? null : cutoff, id, person.removed_from_month, cutoff).run();
    if (!changed.meta.changes) throw new HttpError(409, 'Der Eintrag wurde inzwischen geändert.');
    await log(env, who, restoring ? 'Mitarbeiter wieder aufgenommen' : 'Mitarbeiter entfernt', `${person.name} ab ${cutoff}`);
    return reply({ ok: true });
  }
  if (p === '/api/payroll/employees' && method === 'POST') {
    const b = await body<{ resourceId?: string; name?: string; role?: string; fromMonth: string; payBasis?: 'fixed' | 'hourly';
      salaryCents?: number; hourlyRateCents?: number; monthlyHoursHundredths?: number | null }>();
    const period = month(b.fromMonth);
    const basis = b.payBasis ?? 'fixed';
    if (basis !== 'fixed' && basis !== 'hourly') throw new HttpError(400, 'Bitte Festgehalt oder Stundenlohn auswählen.');
    const hourly = basis === 'hourly';
    const pay = hourly ? b.hourlyRateCents : b.salaryCents;
    if (typeof pay !== 'number' || !Number.isSafeInteger(pay) || pay <= 0) {
      throw new HttpError(400, hourly ? 'Bitte einen Stundensatz über 0,00 € eingeben.' : 'Bitte ein Brutto-Festgehalt über 0,00 € eingeben.');
    }
    const manualHours = hourly && b.monthlyHoursHundredths != null ? monthlyHours(b.monthlyHoursHundredths, pay) : null;
    const hoursPatch = hourly && b.monthlyHoursHundredths !== undefined ? { [MONTHLY_PAYROLL_HOURS]: manualHours } : null;
    await assertOpen(env, period);
    const [planned, local] = await Promise.all([sources.employees(), manualPayrollEmployees(env)]);
    if (b.resourceId) {
      const resourceId = text(b.resourceId, 80);
      const person = planned.find(employee => employee.id === resourceId) ?? local.find(employee => employee.id === resourceId && activePayrollEmployee(employee, period));
      if (!person) throw new HttpError(400, 'Diese Person steht für den gewählten Monat nicht zur Verfügung.');
      const { terms } = await termsFor(env, period, { [person.id]: person.name });
      if (terms[person.id].sub) throw new HttpError(400, 'Diese Vergütung ist nur für Mitarbeiter verfügbar.');
      const statements = [env.DB.prepare(`INSERT INTO payroll_salaries (resource_id, from_month, cents, pay_basis) VALUES (?, ?, ?, ?)
        ON CONFLICT(resource_id, from_month) DO UPDATE SET cents = excluded.cents, pay_basis = excluded.pay_basis`).bind(person.id, period, pay, basis)];
      if (hoursPatch) statements.push(payrollInputChange(env, period, person.id, hoursPatch));
      await env.DB.batch(statements);
      await log(env, who, hourly ? 'Stundenlohn gespeichert' : 'Festgehalt gespeichert', `${person.name} ab ${period}`);
      return reply({ ok: true });
    }
    const name = text(b.name, 100).replace(/\s+/g, ' ');
    const nameKey = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
    const key = nameKey(name);
    if (local.some(person => person.name_key === key) || planned.some(person => nameKey(person.name) === key)) {
      throw new HttpError(409, 'Die Person ist bereits vorhanden. Wähle sie aus der Liste aus.');
    }
    if (b.role !== 'Büro' && b.role !== 'Geschäftsführung') throw new HttpError(400, 'Bitte eine Funktion auswählen.');
    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare('INSERT INTO payroll_employees (id, name, name_key, role, from_month) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name_key) DO NOTHING')
        .bind(id, name, key, b.role, period),
      env.DB.prepare('INSERT INTO payroll_salaries (resource_id, from_month, cents, pay_basis) SELECT id, ?, ?, ? FROM payroll_employees WHERE id = ?')
        .bind(period, pay, basis, id),
    ];
    if (hoursPatch) statements.push(payrollInputChange(env, period, id, hoursPatch, true));
    const [created] = await env.DB.batch(statements);
    if (!created.meta.changes) throw new HttpError(409, 'Die Person ist bereits vorhanden. Wähle sie aus der Liste aus.');
    await log(env, who, 'Mitarbeiter angelegt', `${name} ab ${period}`);
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/payroll\/([\d-]+)$/)) && method === 'GET') {
    const mo = month(m[1]);
    const rows = (await env.DB.prepare('SELECT resource_id, data FROM payroll_inputs WHERE month = ?').bind(mo).all<{ resource_id: string; data: string }>()).results;
    const inputs = Object.fromEntries(rows.map((r) => [r.resource_id, JSON.parse(r.data)]));
    if (url.searchParams.get('includeAllowances') === 'true') {
      return reply({ inputs, allowances: await annualAllowances(env, mo.slice(0, 4)) });
    }
    return reply(inputs);
  }
  if (p === '/api/payroll' && method === 'PUT') {
    const b = await body<{ month: string; resourceId: string; key: string; value: number | string | null }>();
    const mo = month(b.month);
    await assertOpen(env, mo);
    const rid = text(b.resourceId, 80), notes = rid === '_notes';
    if (!(notes ? [...PAYROLL_ABSENCE_NOTES.map(category => category.key), OTHER_PAYMENT_LABEL] : KEYS).includes(b.key)) throw new HttpError(400, 'Unbekanntes Feld.');
    const isColumnLabel = notes && b.key === OTHER_PAYMENT_LABEL;
    const entered = isColumnLabel && typeof b.value === 'string' ? b.value.trim() : b.value;
    if (entered !== null && (notes ? typeof entered !== 'string' || entered.length > (isColumnLabel ? 80 : 10_000) : !Number.isFinite(entered))) throw new HttpError(400, 'Ungültiger Wert.');
    if (b.key === MONTHLY_REVENUE_BONUS) {
      if (b.value !== null) cents(b.value);
      const { terms } = await termsFor(env, mo, { [rid]: '' });
      if (terms[rid].sub) throw new HttpError(400, 'Umsatzbonus ist nur für Mitarbeiter verfügbar.');
    }
    if (b.key === MONTHLY_PAYROLL_HOURS) {
      const { terms } = await termsFor(env, mo, { [rid]: '' });
      const worker = terms[rid];
      if (worker.sub || worker.hourlyRateCents == null) throw new HttpError(400, 'Bitte zuerst einen Stundenlohn für die Person hinterlegen.');
      if (b.value !== null) monthlyHours(b.value, worker.hourlyRateCents);
    }
    await payrollInputChange(env, mo, rid, { [b.key]: entered === '' ? null : entered }).run();
    await log(env, who, 'Lohnabrechnung', `${mo} ${rid} ${b.key}`);
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/roles\/(.+)$/)) && method === 'DELETE') {
    if (who.role !== 'gf') throw new HttpError(403, 'Nur die Geschäftsführung verwaltet Zugänge.');
    const email = decodeURIComponent(m[1]).toLowerCase();
    if (email === who.email) throw new HttpError(409, 'Der eigene Zugang kann nicht entfernt werden.');
    await env.DB.prepare('DELETE FROM roles WHERE email = ?').bind(email).run();
    await log(env, who, 'Zugang entfernt', email);
    return reply({ ok: true });
  }
  if (p === '/api/roles') {
    if (who.role !== 'gf') throw new HttpError(403, 'Nur die Geschäftsführung verwaltet Zugänge.');
    if (method === 'GET') return reply((await env.DB.prepare('SELECT email, role, name FROM roles ORDER BY email').all()).results);
    if (method === 'PUT') {
      const b = await body<{ email: string; role: string; name?: string }>();
      if (!['buchhaltung', 'gf'].includes(b.role)) throw new HttpError(400, 'Rolle unbekannt.');
      await env.DB.prepare('INSERT INTO roles (email, role, name) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name').bind(text(b.email, 200).toLowerCase(), b.role, b.name || '').run();
      await log(env, who, 'Zugang gesetzt', `${b.email} ${b.role}`);
      return reply({ ok: true });
    }
  }
  if (p === '/api/audit' && method === 'GET') return reply((await env.DB.prepare('SELECT at, actor, action, detail FROM audit ORDER BY at DESC LIMIT 200').all()).results);
  throw new HttpError(404, 'Nicht gefunden.');
}

export function createWorker(authenticate: typeof identify = identify, sourcesFor = databaseSources) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      // Every request, pages included, needs a verified identity. Nothing is served to anonymous callers.
      if (!url.pathname.startsWith('/api/')) {
        try { await authenticate(request, env); } catch (e) {
          const status = e instanceof HttpError ? e.status : 500;
          return new Response(status === 403 ? 'Kein Zugang zum Lohntool.' : 'Bitte anmelden.', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY } });
        }
        const res = await env.ASSETS.fetch(request);
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
      }
      try { return await route(request, env, url, authenticate, sourcesFor(env)); } catch (e) {
        if (e instanceof HttpError) return reply({ error: e.message }, e.status);
        console.error(e);
        return reply({ error: 'Interner Fehler.' }, 500);
      }
    },
  };
}

export default createWorker();
