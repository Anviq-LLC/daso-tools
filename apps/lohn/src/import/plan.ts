// Reads hours, travel, meals and absences the same way the Montageplanung evaluation does,
// but always on Europe/Berlin days so a UTC worker buckets punches correctly.
import { MANUAL_HOURS_HINT } from '../calc/labels.ts';
import { surchargeMinutes } from '../calc/time.ts';

export type Punch = { resource_id: string; project_id: string | null; started: string; ended: string | null; pause: number | null };
export type Assignment = { resource_id: string; project_id: string | null; day: string; assignment_type: string };
export type DayEntry = { resource_id: string; day: string; data: string };

export const ABSENT = ['vacation', 'unpaid', 'sick'];
export type PayrollAbsence = 'vacation' | 'unpaid' | 'sick';
export const isOfficeRole = (role: string) => /büro|buero|office|verwaltung|geschäftsführ|geschaeftsfuehr|buchhalt|assistenz/i.test(role);

function dayEntry(raw?: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') ?? {}; } catch { return {}; }
}

export function reportAbsence(type: string, site: unknown): PayrollAbsence | undefined {
  if (type) return type === 'vacation' || type === 'unpaid' || type === 'sick' ? type : undefined;
  if (typeof site !== 'string') return undefined;
  const label = site.trim().toLowerCase();
  if (label.includes('unbezahlt')) return 'unpaid';
  if (label.includes('krank')) return 'sick';
  if (label.includes('urlaub')) return 'vacation';
}

export function reportVacationDates(assignments: Assignment[], entries: DayEntry[]) {
  const planned = new Map<string, string>();
  const vacation = new Map<string, Set<string>>();
  function add(resourceId: string, day: string) {
    const dates = vacation.get(resourceId) ?? new Set<string>();
    dates.add(day);
    vacation.set(resourceId, dates);
  }
  for (const assignment of assignments) {
    const key = assignment.resource_id + '|' + assignment.day;
    if (planned.has(key)) continue;
    planned.set(key, assignment.assignment_type);
    if (assignment.assignment_type === 'vacation') add(assignment.resource_id, assignment.day);
  }
  for (const entry of entries) {
    if (reportAbsence(planned.get(entry.resource_id + '|' + entry.day) ?? '', dayEntry(entry.data).site) === 'vacation') {
      add(entry.resource_id, entry.day);
    }
  }
  return vacation;
}
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// "2027-03-01 00:30" -> { day, time }
export function berlin(iso: string) {
  const [day, time] = fmt.format(new Date(iso)).split(' ');
  return { day, time, local: `${day}T${time}` };
}
export const berlinDay = (iso: string) => berlin(iso).day;

const hrs = (a: string, b: string, pause = 0) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 3600000 - pause / 60);
const mealFor = (type: string, absenceHours: number) => (ABSENT.includes(type) ? 0 : absenceHours >= 24 ? 28 : absenceHours >= 8 ? 14 : 0);

export type Day = {
  day: string;
  type: string;
  projectId: string | null;
  workProjectIds?: string[];
  workMinutes: number;
  travelMinutes: number;
  mealCents: number;
  km: number;
  reportAbsence?: PayrollAbsence;
  absent: boolean;
  halfAbsent: boolean;
  surcharge: { normal: number; night: number; sunday: number; holiday: number };
  warnings: string[];
  stampCheckDue?: boolean;
};

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function computeDay(
  resourceId: string, day: string, assignments: Assignment[], punches: Punch[], entries: DayEntry[], holidays: ReadonlySet<string>, now = berlin(new Date().toISOString()),
  office = false,
): Day {
  const a = assignments.find((x) => x.resource_id === resourceId && x.day === day);
  const type = a?.assignment_type || '';
  const ps = punches
    .filter((p) => p.resource_id === resourceId && p.ended && berlinDay(p.started) === day)
    .sort((x, y) => x.started.localeCompare(y.started));
  const plannedOffice = isOfficeRole(type);
  const officeDay = office || plannedOffice;
  const travel = officeDay ? [] : ps.filter(p => !p.project_id);
  const work = officeDay ? ps : ps.filter(p => p.project_id);
  const sum = (l: Punch[]) => l.reduce((n, p) => n + hrs(p.started, p.ended!, p.pause || 0), 0);
  const lastEnd = ps.reduce((m, p) => (p.ended! > m ? p.ended! : m), '');
  const away = ABSENT.includes(type);
  const raw = entries.find((e) => e.resource_id === resourceId && e.day === day);
  const entry = dayEntry(raw?.data);

  const base = {
    absence: away ? 0 : travel.length ? hrs(travel[0].started, lastEnd) : 0,
    workHours: away ? 8 : work.length ? sum(work) : 0,
    travelHours: travel.length ? sum(travel) : 0,
  };
  const pick = (k: keyof typeof base) => (entry[k] !== undefined && entry[k] !== '' ? num(entry[k]) : base[k]);
  const absence = pick('absence'), workHours = pick('workHours'), travelHours = pick('travelHours');
  const mealOverride = entry.meal !== undefined && entry.meal !== '' && !isNaN(Number(entry.meal));
  const meal = mealOverride ? Number(entry.meal) : mealFor(type, absence);

  const warnings: string[] = [];
  const surcharge = { normal: 0, night: 0, sunday: 0, holiday: 0 };
  if (!away) {
    for (const p of work) {
      const s = surchargeMinutes(berlin(p.started).local, berlin(p.ended!).local, holidays);
      const total = s.normal + s.night + s.sunday + s.holiday;
      const net = Math.max(0, total - (p.pause || 0));
      // The pause is taken out of normal time first so surcharge minutes are never invented.
      const cut = Math.min(s.normal, p.pause || 0);
      s.normal -= cut;
      const rest = (p.pause || 0) - cut;
      if (rest > 0) s.night = Math.max(0, s.night - rest);
      for (const k of Object.keys(surcharge) as (keyof typeof surcharge)[]) surcharge[k] += s[k];
      if (net === 0 && total > 0) warnings.push('Pause länger als Schicht');
    }
    // Manual hour overrides replace the stamped time; keep surcharge minutes only if they still add up.
    const stamped = surcharge.normal + surcharge.night + surcharge.sunday + surcharge.holiday;
    if (stamped && Math.abs(stamped - workHours * 60) > 1) {
      const f = (workHours * 60) / stamped;
      for (const k of Object.keys(surcharge) as (keyof typeof surcharge)[]) surcharge[k] = Math.round(surcharge[k] * f);
      warnings.push(MANUAL_HOURS_HINT);
    }
    if (!stamped && workHours > 0) surcharge.normal = Math.round(workHours * 60);
  }
  const stampCheckDue = day < now.day || (day === now.day && now.time >= '20:00');
  if (stampCheckDue) {
    const open = punches.some(p => p.resource_id === resourceId && !p.ended && berlinDay(p.started) === day);
    const plannedWork = (plannedOffice || (type === 'project' && !!a?.project_id)) && !holidays.has(day);
    if (open) warnings.push('Offene Stempelung');
    else if (!away && !work.length && (plannedWork || workHours > 0)) {
      warnings.push(plannedWork ? 'Keine Stempelung für den geplanten Einsatz' : 'Keine Arbeitsstempelung');
    }
  }
  return {
    day, type, projectId: work[0]?.project_id || a?.project_id || null,
    workProjectIds: [...new Set(work.flatMap(p => p.project_id ? [p.project_id] : []))],
    workMinutes: Math.round(workHours * 60), travelMinutes: Math.round(travelHours * 60),
    mealCents: Math.round(meal * 100), km: num(entry.kmOut) + num(entry.kmBack),
    reportAbsence: reportAbsence(type, entry.site),
    absent: away, halfAbsent: false, surcharge, warnings, stampCheckDue,
  };
}

export function daysOfMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export const dow = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay();
