import { splitNuPeriods, type DateRange, type NuDay, type NuPeriods } from './nu-periods.ts';
// Pure monthly payroll preparation. All money in cents, all time in minutes.
import { hoursPay, progressiveBonusTiers, saturdayBonus, nuProjectBonus, toolInstallment, STANDARD_TIERS, type Tier } from './bonus.ts';
import { replacementRevenue, weekdaysInMonth } from './time.ts';
import { forecastRevenueBonus, forecastWageDays, forecastWorkdayRevenue } from './bonus-forecast.ts';
import type { Day, PayrollAbsence } from '../import/plan.ts';
import { dow, isOfficeRole } from '../import/plan.ts';
import { de, deEur, HOURS_WITHOUT_REVENUE_HINT, MANUAL_HOURS_HINT } from './labels.ts';
import { MONTHLY_PAYROLL_HOURS, summarizeEmployeePay, type Inputs } from './payroll.ts';

export type Terms = {
  name: string;
  lohngruppe: number | null;
  surchargeCents: number; // Lohnzuschlag per hour
  foreman: boolean;
  foremanCostCents: number | null;
  fixedSalaryCents: number | null;
  hourlyRateCents?: number | null;
  bonus: boolean;
  saturday: boolean;
  sub?: boolean; // external hourly worker, paid by invoice, no bonus
  subRateCents?: number | null;
  office?: boolean;
};
export type Settings = {
  rates: Record<number, number>; // Lohngruppe -> cents/h
  tiers: Tier[];
  absenceThreshold: number; // cents, default 8000 EUR
  saturdayRate: number; // percent
  holidays: string[];
  nightPct: number; sundayPct: number; holidayPct: number;
};
export const DEFAULT_SETTINGS: Settings = {
  rates: { 1: 1470, 2: 1516, 3: 1570, 4: 1627, 5: 1720, 6: 1809, 7: 1898, 8: 2037, 9: 2262 },
  tiers: STANDARD_TIERS, absenceThreshold: 800_000, saturdayRate: 40, holidays: [],
  nightPct: 25, sundayPct: 100, holidayPct: 150,
};
export type RevenueRow = { resourceId: string; day: string; projectId: string; label?: string; cents: number; approved: boolean };
export type NuRow = { projectId: string; projectName: string; foremanId: string | null; revenue: number; cost: number | null; approved: boolean; daily?: Record<string, NuDay>; issues?: NuIssue[]; undatedCosts?: DateRange[] };
export type NuIssue = { day: string; end: string; team: string; reason: string; reportId?: string };
export type NuAssign = { firstId: string | null; secondId: string | null; secondPct: number; periods?: NuPeriods };
export type ToolAccount = { priceCents: number; monthlyRateCents: number; paidBefore: number; prepaid: number };
export type Adjustment = { id: string; resourceId: string; kind: string; label: string; cents: number; taxable?: boolean };

export type CalendarDay = { day: string; workMinutes: number; travelMinutes?: number; absence: string; payrollAbsence?: PayrollAbsence; revenue: { label: string; cents: number }[]; replacementRevenue?: number; projectedRevenue?: number; flag: '' | 'gap' | 'error'; note: string };
export type SubDay = { day: string; projects: string[]; workMinutes: number; travelMinutes: number };
export type SubWeek = { kw: string; workMinutes: number; travelMinutes: number; cents: number; days?: SubDay[] };
export type Line = { code: string; label: string; cents: number; note?: string };
export type Row = {
  resourceId: string; name: string; lines: Line[]; sub?: boolean;
  overview?: { worked: number; travel: number; revenue: number; vacation: number; sick: number; holiday: number };
  payout: number; spesen: number; km: number;
  calendar?: CalendarDay[];
  weeks?: SubWeek[];
  payrollHours?: { minutes: number; ratePerHour: number | null; editable?: true };
  payrollAbsences?: { vacation: number; unpaid: number; sick: number };
  vacationBalanceBefore?: number;
  paySummary?: ReturnType<typeof summarizeEmployeePay>;
  revenueBonus?: {
    enabled: boolean;
    override?: number;
    tiers: ReturnType<typeof progressiveBonusTiers>;
    replacement?: {
      threshold: number;
      weekdays: number;
      perDay: number;
      days: { vacation: number; unpaid: number; sick: number; holiday: number };
    };
    forecast: ReturnType<typeof forecastRevenueBonus>;
  };
  metrics: { workMinutes: number; travelMinutes: number; absentDays: number; revenue: number; saturdayRevenue: number; replacement: number };
  carryOut: number; warnings: string[];
};
export type NuProjectRow = {
  projectId: string; projectName: string; revenue: number | null; cost: number | null; profit: number | null;
  otherCost?: number; missingRevenue?: number; missingCosts?: number; issues?: NuIssue[]; periods?: NuPeriods;
  shares?: ReturnType<typeof splitNuPeriods>;
  bonus: number; firstId: string | null; secondId: string | null; secondPct: number;
};
export type MonthResult = {
  month: string; rows: Row[]; nuProjects?: NuProjectRow[]; nuProjectsError?: string;
  nu: (NuProjectRow & { foremanId: string | null; revenue: number })[];
  warnings: string[];
};

export function isoWeek(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday decides the year
  const y = d.getUTCFullYear();
  const w = 1 + Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);

export function computeMonth(input: {
  month: string; settings: Settings; terms: Record<string, Terms>; days: Record<string, Day[]>; projectNames?: ReadonlyMap<string, string>;
  revenue: RevenueRow[]; enteredRevenue?: RevenueRow[]; asOf?: string; nu: NuRow[]; foremanMinutes: Record<string, Record<string, number>>; // foremanId -> projectId -> minutes
  foremanDaily?: Record<string, Record<string, Record<string, number>>>;
  otherNuCosts: Record<string, number>; nuAssign?: Record<string, NuAssign>; adjustments: Adjustment[]; tools: Record<string, ToolAccount>;
  carryIn: Record<string, number>; importWarnings?: string[];
  revenueBonusOverrides?: Record<string, number>;
  payrollInputs?: Record<string, Inputs>;
}): MonthResult {
  const { month, settings: s } = input;
  const [y, m] = month.split('-').map(Number);
  const replacementBasis = { threshold: s.absenceThreshold, weekdays: weekdaysInMonth(y, m),
    perDay: replacementRevenue(s.absenceThreshold, y, m, 1) };
  const holidays = new Set(s.holidays);
  const warnings = [...(input.importWarnings || [])];
  if (!s.holidays.length) warnings.push('Feiertage sind nicht hinterlegt: Zuschläge und Ersatzumsatz für Feiertage fehlen.');

  const nu: MonthResult['nu'] = input.nu.map((n) => {
    const a = input.nuAssign?.[n.projectId];
    const firstId = a ? a.firstId : n.foremanId;
    const secondId = a?.secondId ?? null, secondPct = secondId ? Math.min(100, Math.max(0, a?.secondPct ?? 0)) : 0;
    const periods = firstId && secondId ? a?.periods : undefined;
    const { daily, undatedCosts, ...visible } = n;
    const base = { ...visible, firstId, secondId, secondPct, periods, otherCost: input.otherNuCosts[n.projectId] ?? 0 };
    if (n.cost === null || n.issues?.length) { warnings.push(`NU-Projekt ${n.projectName}: Aufmaßwerte unvollständig, Bonus offen.`); return { ...base, profit: null, bonus: 0 }; }
    const costRate = (n.foremanId && input.terms[n.foremanId]?.foremanCostCents) || 0;
    const fm = n.foremanId ? input.foremanMinutes[n.foremanId]?.[n.projectId] || 0 : 0;
    const r = nuProjectBonus({ nuRevenue: n.revenue, nuCost: n.cost, foremanMinutes: fm, foremanCostPerHour: costRate, otherCost: base.otherCost });
    const foremanDaily = n.foremanId ? input.foremanDaily?.[n.foremanId]?.[n.projectId] ?? {} : {};
    const shares = periods && daily ? splitNuPeriods(r.bonus, periods, daily, foremanDaily, costRate, base.otherCost, undatedCosts ?? []) : undefined;
    return { ...base, profit: n.revenue - n.cost - base.otherCost, bonus: r.bonus, shares };
  });
  const nuByPerson: Record<string, { label: string; cents: number }[]> = {};
  for (const n of nu) {
    if (!n.bonus) continue;
    if (!n.firstId) { warnings.push(`NU-Projekt ${n.projectName}: kein Empfänger für den Bonus.`); continue; }
    if (n.shares?.unassigned) warnings.push(`NU-Projekt ${n.projectName}: Bonusanteil ist zeitlich noch nicht zugeordnet.`);
    const second = n.shares?.second ?? (n.secondId ? Math.round(n.bonus * n.secondPct / 100) : 0);
    const first = n.shares?.first ?? n.bonus - second;
    if (first) (nuByPerson[n.firstId] ||= []).push({ label: `NU-Bonus ${n.projectName}`, cents: first });
    if (n.secondId && second) (nuByPerson[n.secondId] ||= []).push({ label: `NU-Bonus ${n.projectName}`, cents: second });
  }

  const rows: Row[] = Object.entries(input.terms).map(([id, t]) => {
    const w: string[] = [];
    const days = input.days[id] || [];
    const customHourly = t.fixedSalaryCents === null && t.hourlyRateCents != null;
    const rate = t.hourlyRateCents ?? (t.lohngruppe ? (s.rates[t.lohngruppe] ?? 0) + t.surchargeCents : 0);
    const recordedHours = input.payrollInputs?.[id]?.[MONTHLY_PAYROLL_HOURS];
    const manualHours = customHourly && recordedHours !== undefined && Number.isSafeInteger(recordedHours) && recordedHours >= 0
      ? recordedHours : undefined;
    const lines: Line[] = [];
    let workMin = 0, travelMin = 0, absentDays = 0, spesen = 0, km = 0;
    const entered = (input.enteredRevenue ?? input.revenue).filter(row => row.resourceId === id);
    const overview = { worked: 0, travel: 0, revenue: sum(entered.map(row => row.cents)), vacation: 0, sick: 0, holiday: 0 };
    const payrollAbsences = { vacation: 0, unpaid: 0, sick: 0 };
    const cat = { normal: 0, night: 0, sunday: 0, holiday: 0 };
    const replacementDays = { vacation: 0, unpaid: 0, sick: 0, holiday: 0 };
    const replacementByDay = new Map<string, number>();
    let replacement = 0;
    let paidAbsenceMin = 0;
    const bonusEnabled = t.bonus && t.fixedSalaryCents === null && !t.office;
    for (const d of days) {
      km += d.km;
      spesen += d.mealCents;
      if (d.reportAbsence) payrollAbsences[d.reportAbsence]++;
      for (const k of Object.keys(cat) as (keyof typeof cat)[]) cat[k] += d.surcharge[k];
      workMin += d.workMinutes;
      travelMin += d.travelMinutes;
      const weekday = dow(d.day) >= 1 && dow(d.day) <= 5;
      const holidayOff = weekday && holidays.has(d.day) && !d.workMinutes;
      if (!input.asOf || d.day <= input.asOf) {
        if (!d.absent) overview.worked += d.workMinutes;
        overview.travel += d.travelMinutes;
        if (holidayOff) overview.holiday++;
        else if (weekday && d.type === 'vacation') overview.vacation++;
        else if (weekday && d.type === 'sick') overview.sick++;
      }
      if (weekday && (d.absent || holidayOff)) {
        absentDays++;
        if (bonusEnabled && !t.sub) {
          const cumulative = replacementRevenue(s.absenceThreshold, y, m, absentDays);
          replacementByDay.set(d.day, cumulative - replacement);
          replacement = cumulative;
        }
        if (d.type !== 'unpaid') paidAbsenceMin += 480;
        if (d.type === 'vacation' || d.type === 'unpaid' || d.type === 'sick') replacementDays[d.type]++;
        else if (holidayOff) replacementDays.holiday++;
      }
      for (const x of d.warnings) {
        if (x !== MANUAL_HOURS_HINT) w.push(`${d.day}: ${x}`);
      }
    }
    if (t.sub) {
      const subRate = t.subRateCents ?? 0;
      if (t.subRateCents == null) w.push('Kein Stundensatz hinterlegt.');
      const byWeek = new Map<string, SubWeek & { days: SubDay[] }>();
      let subWork = 0;
      for (const d of days) {
        const work = d.absent ? 0 : d.workMinutes;
        if (!work && !d.travelMinutes) continue;
        const wk = isoWeek(d.day), e = byWeek.get(wk) || { kw: wk, workMinutes: 0, travelMinutes: 0, cents: 0, days: [] };
        const ids = d.workProjectIds?.length ? d.workProjectIds : d.projectId ? [d.projectId] : [];
        const projects = [...new Set(ids.flatMap(id => {
          const name = input.projectNames?.get(id);
          return name ? [name] : [];
        }))];
        e.days.push({ day: d.day, projects, workMinutes: work, travelMinutes: d.travelMinutes });
        e.workMinutes += work; e.travelMinutes += d.travelMinutes; subWork += work;
        byWeek.set(wk, e);
      }
      const weeks = [...byWeek.values()].sort((a, b) => a.kw.localeCompare(b.kw));
      for (const e of weeks) e.cents = hoursPay(e.workMinutes + e.travelMinutes, subRate);
      lines.push({ code: 'SUBH', label: 'SUB Stunden', cents: hoursPay(subWork, subRate), note: `${de(subWork / 60)} h` });
      if (travelMin) lines.push({ code: 'SUBA', label: 'SUB Anfahrt', cents: hoursPay(travelMin, subRate), note: `${de(travelMin / 60)} h` });
      return {
        resourceId: id, name: t.name, lines, sub: true, overview, payout: sum(lines.map((l) => l.cents)), spesen, km, weeks,
        metrics: { workMinutes: subWork, travelMinutes: travelMin, absentDays, revenue: 0, saturdayRevenue: 0, replacement: 0 }, carryOut: 0, warnings: w,
      };
    }
    const normalPay = cat.normal;
    if (t.fixedSalaryCents !== null) {
      lines.push({ code: 'FIX', label: 'Festgehalt', cents: t.fixedSalaryCents });
    } else if (manualHours !== undefined) {
      lines.push({ code: 'LOHN', label: 'Stundenlohn', cents: Math.round(manualHours * rate / 100),
        note: `${de(manualHours / 100)} h × ${deEur(rate)}/h` });
    } else {
      const base = rate;
      if (normalPay) lines.push({ code: 'LOHN', label: 'Stundenlohn', cents: hoursPay(normalPay, base), note: `${de(normalPay / 60)} h` });
      const z = [['night', s.nightPct, 'Nachtzuschlag'], ['sunday', s.sundayPct, 'Sonntag'], ['holiday', s.holidayPct, 'Feiertag']] as const;
      for (const [k, pct, label] of z) if (cat[k]) lines.push({ code: 'ZUS_' + k.toUpperCase(), label, cents: hoursPay(cat[k], Math.round((base * (100 + pct)) / 100)), note: `${de(cat[k] / 60)} h inkl. ${pct} %` });
      if (paidAbsenceMin) lines.push({ code: 'ABW', label: 'Urlaub, Krank, Feiertag', cents: hoursPay(paidAbsenceMin, base), note: `${paidAbsenceMin / 480} Tage` });
      if (t.foreman && travelMin) lines.push({ code: 'ANF', label: 'Anfahrt Obermonteur', cents: hoursPay(travelMin, base), note: `${de(travelMin / 60)} h` });
    }

    const mine = input.revenue.filter((r) => r.resourceId === id);
    const satRev = sum(mine.filter((r) => dow(r.day) === 6).map((r) => r.cents));
    const weekRev = sum(mine.filter((r) => dow(r.day) !== 6).map((r) => r.cents));
    const prediction = t.office ? null : forecastWorkdayRevenue(month, input.asOf, days, holidays, entered);
    const remaining = new Set(prediction?.remaining);
    const ABSENCE: Record<string, string> = { vacation: 'Urlaub', sick: 'Krank', unpaid: 'Unbezahlt' };
    const calendar: CalendarDay[] = days.map((d) => {
      const rev = entered.filter((r) => r.day === d.day).map((r) => ({ label: r.label || r.projectId, cents: r.cents }));
      const weekday = dow(d.day) >= 1 && dow(d.day) <= 5;
      const worked = !d.absent && d.workMinutes > 0;
      let flag: CalendarDay['flag'] = '', note = '';
      if (rev.length && !worked && d.stampCheckDue !== false) { flag = 'error'; note = 'Umsatz ohne Stunden'; }
      else if (worked && !rev.length && !t.office && !isOfficeRole(d.type) && d.stampCheckDue !== false) {
        flag = 'gap';
        note = HOURS_WITHOUT_REVENUE_HINT;
        w.push(`${d.day.split('-').reverse().join('.')}: ${note}`);
      }
      else if (!t.office && d.stampCheckDue !== false && weekday && !d.absent && !d.workMinutes && !holidays.has(d.day)) { flag = 'gap'; note = 'Kein Eintrag'; }
      if (d.warnings.length) { flag = 'error'; note = [note, ...d.warnings].filter(Boolean).join(', '); }
      return {
        day: d.day, workMinutes: d.absent ? 0 : d.workMinutes,
        travelMinutes: t.foreman ? d.travelMinutes : undefined,
        absence: d.absent ? ABSENCE[d.type] || d.type : '', payrollAbsence: d.reportAbsence, revenue: rev, flag, note,
        replacementRevenue: replacementByDay.get(d.day),
        projectedRevenue: remaining.has(d.day) ? prediction?.averageRevenue : undefined,
      };
    });
    const pot = weekRev + replacement;
    const forecastBasis = sum(entered.filter(row => dow(row.day) !== 6).map(row => row.cents)) + replacement;
    const tiers = bonusEnabled ? progressiveBonusTiers(pot, s.tiers) : [];
    const override = input.revenueBonusOverrides?.[id];
    const bonus = override ?? sum(tiers.map(tier => tier.cents));
    if (bonus) lines.push({ code: 'UMS', label: 'Umsatzbonus', cents: bonus,
      note: override === undefined ? `Umsatz ${deEur(pot)}` : 'Manuell festgelegt' });
    const saturday = bonusEnabled && t.saturday ? saturdayBonus(satRev, s.saturdayRate) : 0;
    if (saturday) lines.push({ code: 'SAM', label: 'Samstagsbonus', cents: saturday,
      note: `${s.saturdayRate} % von ${deEur(satRev)} Samstagsumsatz` });
    for (const b of nuByPerson[id] || []) lines.push({ code: 'NU', label: b.label, cents: b.cents });
    for (const a of input.adjustments.filter(x => x.resourceId === id && (override === undefined || x.kind !== 'korrektur'))) {
      lines.push({ code: a.kind.toUpperCase(), label: a.label, cents: a.cents });
    }

    const carry = input.carryIn[id] || 0;
    if (carry) lines.push({ code: 'VORTRAG', label: 'Übertrag Vormonat', cents: carry });

    const tool = input.tools[id];
    if (tool) {
      const t2 = toolInstallment(tool.priceCents, tool.paidBefore + tool.prepaid, 0, tool.monthlyRateCents);
      if (t2.installment) lines.push({ code: 'WZG', label: 'Werkzeugrate', cents: -t2.installment, note: `Restschuld danach ${deEur(t2.debt - t2.installment)}` });
    }

    // Corrections may push the bonus part negative. Nothing is clawed back from wages, the minus moves on.
    const bonusLike = lines.filter((l) => ['UMS', 'SAM', 'NU', 'KORREKTUR', 'VORTRAG'].includes(l.code));
    const bonusSum = sum(bonusLike.map((l) => l.cents));
    let carryOut = 0;
    if (bonusSum < 0) {
      carryOut = bonusSum;
      lines.push({ code: 'SALDO', label: 'Negativer Bonus wird übertragen', cents: -bonusSum });
    }
    const forecast = bonusEnabled ? forecastRevenueBonus(month, input.asOf, days, holidays, entered, forecastBasis, s.tiers) : null;
    const row: Row = {
      resourceId: id, name: t.name, lines, sub: false, overview, payout: 0, spesen, km, calendar,
      payrollAbsences,
      payrollHours: t.fixedSalaryCents === null ? {
        minutes: manualHours === undefined
          ? normalPay + cat.night + cat.sunday + cat.holiday + paidAbsenceMin + (t.foreman ? travelMin : 0)
          : manualHours * 60 / 100,
        ratePerHour: rate > 0 ? rate : null,
        ...(customHourly ? { editable: true as const } : {}),
      } : overview.worked ? { minutes: overview.worked + (t.foreman ? overview.travel : 0), ratePerHour: null } : undefined,
      revenueBonus: { enabled: bonusEnabled, tiers, override,
        replacement: t.bonus ? { ...replacementBasis, days: replacementDays } : undefined,
        forecast: forecast?.remainingDays ? forecast : null },
      metrics: { workMinutes: workMin, travelMinutes: travelMin, absentDays, revenue: pot, saturdayRevenue: satRev, replacement },
      carryOut, warnings: w,
    };
    const wageDays = t.fixedSalaryCents === null && rate > 0 && manualHours === undefined
      ? forecastWageDays(month, input.asOf, days, holidays) : 0;
    row.paySummary = summarizeEmployeePay(row, input.payrollInputs?.[id], wageDays, rate);
    return row;
  });

  for (const r of rows) {
    r.payout = sum(r.lines.map((l) => l.cents));
  }
  return { month, rows, nu, warnings };
}

export { weekdaysInMonth };
