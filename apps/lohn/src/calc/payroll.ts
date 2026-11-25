// Steuerberater sheet: columns that come from the month calculation can be overridden, the rest is typed in per month.
import type { Row } from './month.ts';
import { hoursPay } from './bonus.ts';
import { dow } from '../import/plan.ts';

export type Inputs = Record<string, number>;
export const ANNUAL_ALLOWANCE_LIMITS = { notfall: 60_000, werkzeugGeld: 80_000 };
export type AnnualAllowances = Record<keyof typeof ANNUAL_ALLOWANCE_LIMITS, number>;
type Col = { key: string; label: string; auto?: (r: Row, input: Inputs) => number | undefined };
const sum = (r: Row, codes: string[]) => r.lines.filter((l) => codes.includes(l.code)).reduce((n, l) => n + l.cents, 0);

export const GROSS: Col[] = [
  { key: 'grundgehalt', label: 'Grundgehalt', auto: (r) => sum(r, ['FIX', 'LOHN', 'ZUS_NIGHT', 'ZUS_SUNDAY', 'ZUS_HOLIDAY', 'ABW', 'ANF']) },
  { key: 'umsatzbonus', label: 'Umsatzbonus', auto: (r) => sum(r, ['UMS', 'SAM']) },
  { key: 'bauleiter', label: 'Bauleiterbonus', auto: (r) => sum(r, ['NU']) },
  { key: 'sonstiges', label: 'Korrektur Vormonat, Prämien', auto: (r) => sum(r, ['KORREKTUR', 'PRAEMIE', 'SONSTIGES', 'VORTRAG', 'SALDO']) },
];
export const OTHER_PAYMENT: Col = { key: 'benzin', label: 'Sonstiges' };
export const OTHER_PAYMENT_LABEL = 'otherPaymentLabel';
export const PAYROLL_ABSENCE_NOTES = [
  { key: 'unpaid', label: 'Unbezahlter Urlaub', legacy: 'Unbezahlt' },
  { key: 'vacation', label: 'Urlaub', legacy: 'Urlaub' },
  { key: 'sick', label: 'Krank', legacy: 'Krank' },
] as const;

export function payrollAbsenceList(rows: Row[], category: typeof PAYROLL_ABSENCE_NOTES[number]) {
  return rows.flatMap(row => {
    const days = (row.calendar ?? []).filter(day => day.payrollAbsence
      ? day.payrollAbsence === category.key
      : day.absence === category.legacy);
    const workdays = [...new Set(days.map(({ day }) => day))].filter(day => {
      const weekday = dow(day);
      return weekday >= 1 && weekday <= 5;
    }).sort();
    if (!workdays.length) return [];
    const ranges: { from: string; to: string }[] = [];
    for (const day of workdays) {
      const last = ranges.at(-1);
      const expectedGap = last && dow(last.to) === 5 ? 3 : 1;
      if (last && Date.parse(day) - Date.parse(last.to) === expectedGap * 86_400_000) last.to = day;
      else ranges.push({ from: day, to: day });
    }
    const shortDate = (day: string) => `${day.slice(8)}.${day.slice(5, 7)}.`;
    const dates = ranges.map(({ from, to }) => from === to ? shortDate(from) : `vom ${shortDate(from)} bis ${shortDate(to)}`);
    return [`${row.name}: ${dates.join(', ')}`];
  }).join('\n');
}
export const MONEY: Col[] = [
  { key: 'vl', label: 'VL' }, { key: 'fitness', label: 'Fitness' }, { key: 'firmenwagen', label: 'Firmenwagen 1 % Betrag' },
  { key: 'notfall', label: 'Notfall Zusatzgeld netto', auto: (r) => sum(r, ['NOTFALL']) },
  { key: 'werkzeugAbzug', label: 'Werkzeug Abzug', auto: (r) => -sum(r, ['WZG']) },
  { key: 'werkzeugGeld', label: 'Werkzeuggeld' }, OTHER_PAYMENT,
  { key: 'reiseFrei', label: 'Reisekosten steuerfrei', auto: (r) => r.spesen },
  { key: 'reisePausch', label: 'Reisekosten pauschalversteuert' },
  { key: 'auslagen', label: 'Auslagenerstattung', auto: (r) => sum(r, ['AUSLAGEN']) },
];
export const DISTANCE: Col = { key: 'kilometer', label: 'Kilometer', auto: (r) => r.km };
export const KM: Col = { key: 'kmPauschale', label: 'Kilometerpauschale', auto: (r, input) => Math.round(value(DISTANCE, r, input) * 30) };
const vacationTaken: Col = { key: 'urlaub', label: 'Urlaub genommen', auto: r => r.payrollAbsences?.vacation ?? r.overview?.vacation };
export const DAYS: Col[] = [
  { key: 'unbezahlt', label: 'Unbezahlter Urlaub', auto: r => r.payrollAbsences?.unpaid ?? r.calendar?.filter(day => day.absence === 'Unbezahlt').length },
  vacationTaken,
  { key: 'krank', label: 'Krank', auto: r => r.payrollAbsences?.sick ?? r.overview?.sick },
  { key: 'uebrig', label: 'Urlaub übrig', auto: (r, input) => r.vacationBalanceBefore === undefined
    ? undefined : r.vacationBalanceBefore - value(vacationTaken, r, input) },
];
export const MONTHLY_REVENUE_BONUS = 'umsatzbonusMonat';
export const MONTHLY_PAYROLL_HOURS = 'payrollHoursHundredths';
export const KEYS = [...GROSS, ...MONEY, KM, DISTANCE, ...DAYS].map(c => c.key).concat(MONTHLY_REVENUE_BONUS, MONTHLY_PAYROLL_HOURS);

export const fieldValue = (c: Col, r: Row, input: Inputs) => input[c.key] ?? c.auto?.(r, input);
export const value = (c: Col, r: Row, input: Inputs) => fieldValue(c, r, input) ?? 0;
export const brutto = (r: Row, inp: Inputs) => GROSS.reduce((n, c) => n + value(c, r, inp), 0);


export const FORECAST_HOURS_PER_DAY = 8;

export function summarizeEmployeePay(row: Row, inputs: Inputs = {}, openWorkdays = 0, rate = 0) {
  const monthlyBonus = sum(row, ['UMS']);
  const calculatedBonus = row.revenueBonus?.tiers.reduce((total, tier) => total + tier.cents, 0) ?? monthlyBonus;
  const correction = monthlyBonus - calculatedBonus + sum(row, ['KORREKTUR']);
  const base = value(GROSS[0], row, inputs);
  const gross = brutto(row, inputs);
  const actual = { base, bonus: calculatedBonus, correction, other: gross - base - calculatedBonus - correction, gross };
  const wageDays = inputs.grundgehalt === undefined ? openWorkdays : 0;
  const projectedBonus = inputs.umsatzbonus === undefined ? row.revenueBonus?.forecast?.projectedBonus : undefined;
  if (!wageDays && projectedBonus === undefined) return { actual, forecast: null };

  const bonus = projectedBonus ?? calculatedBonus;
  const bonusDelta = bonus - calculatedBonus;
  const baseIncrease = hoursPay(wageDays * FORECAST_HOURS_PER_DAY * 60, rate);
  const projectedBonusBalance = monthlyBonus + bonusDelta + sum(row, ['KORREKTUR', 'SAM', 'NU', 'VORTRAG']);
  const balanceDelta = inputs.sonstiges === undefined ? Math.max(0, -projectedBonusBalance) - sum(row, ['SALDO']) : 0;
  const projectedGross = gross + baseIncrease + bonusDelta + balanceDelta;
  return { actual, forecast: { base: base + baseIncrease, bonus, correction,
    other: projectedGross - (base + baseIncrease) - bonus - correction, gross: projectedGross, wageDays, bonusProjected: projectedBonus !== undefined } };
}

export function payrollBonusForecast(row: Row, inputs: Inputs): Inputs | null {
  const { actual, forecast } = summarizeEmployeePay(row, inputs);
  if (!forecast?.bonusProjected) return null;
  return {
    umsatzbonus: value(GROSS[1], row, inputs) + forecast.bonus - actual.bonus,
    sonstiges: value(GROSS[3], row, inputs) + forecast.other - actual.other,
  };
}
