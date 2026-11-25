import { useEffect, useState } from 'react';
import { api, eur, fromCents, hours, toCents, type MonthView } from './api.ts';
import { GROSS, MONEY, KM, DISTANCE, DAYS, OTHER_PAYMENT, OTHER_PAYMENT_LABEL, ANNUAL_ALLOWANCE_LIMITS, PAYROLL_ABSENCE_NOTES, MONTHLY_PAYROLL_HOURS,
  brutto, fieldValue, payrollAbsenceList, payrollBonusForecast, value, type AnnualAllowances, type Inputs } from '../calc/payroll.ts';
import { PayrollPrint } from './PayrollPrint.tsx';
import { PayrollEmployeeForm } from './PayrollEmployeeForm.tsx';
import { ReopenMonth } from './ReopenMonth.tsx';
import './payroll-print.css';

type All = Record<string, Inputs>;
type PayrollDetails = { inputs: All; allowances: Record<string, AnnualAllowances> };
type Col = (typeof GROSS)[number];
const MONEY_COLS = [...MONEY, KM];
const MONTHLY_HOURS: Col = {
  key: MONTHLY_PAYROLL_HOURS, label: 'Stunden',
  auto: row => row.payrollHours && Math.round(row.payrollHours.minutes * 100 / 60),
};
const numbers = new Intl.NumberFormat('de-DE', { useGrouping: false, maximumFractionDigits: 6 });
const numberText = (value: number | undefined) => value === undefined ? '' : numbers.format(value);
const cell = (v: string | number) => { const s = String(v); const q = /^[=+@]|^-(?!\d)/.test(s) ? "'" + s : s; return /[;"\n]/.test(q) ? '"' + q.replace(/"/g, '""') + '"' : q; };

export function PayrollPage({ month, setMonth, role }: { month: string; setMonth: (m: string) => void; role: string }) {
  const [loaded, setLoaded] = useState<(PayrollDetails & { month: string; view: MonthView; revision: number }) | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [columnName, setColumnName] = useState<string | null>(null);
  const [savingColumnName, setSavingColumnName] = useState(false);
  const [editingEmployees, setEditingEmployees] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([api<MonthView>(`/api/months/${month}`), api<PayrollDetails>(`/api/payroll/${month}?includeAllowances=true`)])
      .then(([view, details]) => { if (active) setLoaded({ month, view, revision, ...details }); })
      .catch(e => { if (active) { setError(e.message); setLoaded(null); } });
    return () => { active = false; };
  }, [month, revision]);
  const current = loaded?.month === month ? loaded : null;
  const view = current?.view;
  const inputs = current?.inputs ?? {};

  const rows = view?.result.rows.filter(r => !r.sub && !r.weeks) || [];
  const frozen = !!view?.frozen;
  const sheet = rows.map(row => {
    const input = inputs[row.resourceId] || {};
    const forecast = frozen ? null : payrollBonusForecast(row, input);
    return { row, input, forecast, displayed: forecast ? { ...input, ...forecast } : input };
  });
  const hasForecast = sheet.some(({ forecast }) => !!forecast);
  const put = async (resourceId: string, key: string, v: number | string | null) => {
    setPendingWrites(n => n + 1);
    try {
      await api('/api/payroll', 'PUT', { month, resourceId, key, value: v });
      setRevision(n => n + 1);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setPendingWrites(n => n - 1); }
  };
  const notes = (inputs._notes || {}) as unknown as Record<string, string>;
  const absenceNotes = PAYROLL_ABSENCE_NOTES.map(category => {
    const automatic = payrollAbsenceList(rows, category);
    const manual = notes[category.key];
    return { ...category, automatic, manual, text: manual ?? automatic };
  });
  const otherLabel = notes[OTHER_PAYMENT_LABEL] || OTHER_PAYMENT.label;
  const moneyCols = MONEY_COLS.map(column => column.key === OTHER_PAYMENT.key ? { ...column, label: otherLabel } : column);
  const allowanceNote = (resourceId: string, key: keyof AnnualAllowances) => {
    const paid = current?.allowances[resourceId]?.[key] ?? 0;
    const remaining = Math.max(0, ANNUAL_ALLOWANCE_LIMITS[key] - Math.max(0, paid));
    return <div className="muted allowance-note" title={`Im Kalenderjahr erfasst: ${eur(paid)}`}>Jahresrest {eur(remaining)}</div>;
  };

  async function saveColumnName() {
    if (columnName === null || savingColumnName || frozen) return;
    const name = columnName.trim();
    if (name === otherLabel) { setColumnName(null); return; }
    setSavingColumnName(true);
    try {
      if (await put('_notes', OTHER_PAYMENT_LABEL, name || null)) setColumnName(null);
    } finally {
      setSavingColumnName(false);
    }
  }

  const csv = () => {
    const head = ['Mitarbeiter', ...GROSS.map((c) => c.label), 'Gesamt Brutto', ...moneyCols.map((c) => c.label), DISTANCE.label, ...DAYS.map((c) => c.label)];
    const out = [head.map(cell).join(';')];
    for (const r of rows) {
      const inp = inputs[r.resourceId] || {};
      const f = (c: Col) => fromCents(value(c, r, inp));
      out.push([r.name, ...GROSS.map(f), fromCents(brutto(r, inp)), ...moneyCols.map(f),
        numberText(fieldValue(DISTANCE, r, inp)), ...DAYS.map(c => numberText(fieldValue(c, r, inp)))].map(cell).join(';'));
    }
    out.push('', ...absenceNotes.map(({ label, text }) => [label, text].map(cell).join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    a.download = `loehne-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const money = (r: (typeof rows)[number], c: Col, projected?: number) => {
    const inp = inputs[r.resourceId] || {};
    const auto = projected ?? c.auto?.(r, inp) ?? 0;
    return <input aria-label={`${c.label} ${r.name}`} className="amt" inputMode="decimal" disabled={frozen} placeholder={auto || projected !== undefined ? fromCents(auto) : ''}
      key={r.resourceId + c.key + (inp[c.key] ?? 'auto')} defaultValue={c.key in inp ? fromCents(inp[c.key]) : ''}
      onBlur={(e) => { const t = e.target.value.trim(); const cents = t ? toCents(t) : null; if (t && cents === null) return; if (cents !== (c.key in inp ? inp[c.key] : null)) put(r.resourceId, c.key, cents); }} />;
  };
  const numberInput = (r: (typeof rows)[number], c: Col, input: Inputs) => (
    <input aria-label={`${c.label} ${r.name}`} className="amt day" inputMode="decimal" disabled={frozen}
      key={r.resourceId + c.key + (input[c.key] ?? '')} defaultValue={numberText(input[c.key])}
      placeholder={numberText(c.auto?.(r, input)) || '–'}
      onBlur={event => {
        const text = event.currentTarget.value.trim().replace(',', '.');
        const number = text ? Number(text) : null;
        if (number !== null && !Number.isFinite(number)) {
          event.currentTarget.value = numberText(input[c.key]);
          setError('Bitte eine gültige Zahl eingeben.');
          return;
        }
        if (number !== (input[c.key] ?? null)) void put(r.resourceId, c.key, number);
      }} />
  );
  const total = (c: Col) => sheet.reduce((n, { row, displayed }) => n + value(c, row, displayed), 0);

  return (
    <section className="payroll-page">
      <h1>Lohnabrechnung für den Steuerberater</h1>
      <div className="toolbar">
        <label>Monat <input type="month" value={month} disabled={savingColumnName} onChange={e => {
          if (e.target.value) { setColumnName(null); setEditingEmployees(false); setMonth(e.target.value); }
        }} /></label>
        {frozen
          ? <span className="muted">{view?.status === 'abgeschlossen' ? 'Abgeschlossen' : 'Freigegeben'} · Nur Ansicht</span>
          : <span className="muted">Graue Werte sind berechnet. Eintragen überschreibt sie, leeren stellt sie wieder her.</span>}
        <span className="spacer" />
        {frozen && role === 'gf' && <ReopenMonth key={month} month={month} onReopened={() => setRevision(n => n + 1)} />}
        {view && !frozen && <button type="button" aria-expanded={editingEmployees}
          onClick={() => setEditingEmployees(editing => !editing)}>Mitarbeiter hinzufügen</button>}
        <button onClick={csv} disabled={!rows.length}>Export CSV</button>
        <button disabled={!view || pendingWrites > 0 || current?.revision !== revision} onClick={() => window.print()}>Drucken / PDF</button>
      </div>
      {editingEmployees && !frozen && <PayrollEmployeeForm key={month} month={month} onCancel={() => setEditingEmployees(false)}
        onSaved={period => {
          setEditingEmployees(false);
          if (period === month) setRevision(n => n + 1);
          else setMonth(period);
        }} />}
      {error && <p role="alert" className="error">{error}</p>}
      {view && (
        <div className="scroll">
          <table className="grid payroll" data-testid="payroll-table">
            <thead><tr>
              <th className="sticky">{month}</th>
              <th className="num" title="Für die Abrechnung erfasste Stunden">Stunden</th>
              <th className="num">Stundensatz</th>
              {GROSS.map((c) => <th key={c.key} className="num">{c.label}</th>)}<th className="num">Gesamt Brutto</th>
              {moneyCols.map(c => <th key={c.key} className="num">
                {c.label}
                {c.key === OTHER_PAYMENT.key && !frozen && (columnName === null
                  ? <button type="button" className="link payroll-rename" aria-label={`Spalte ${c.label} umbenennen`} title="Spalte umbenennen"
                    onClick={() => setColumnName(c.label)}>✎</button>
                  : <form className="payroll-column-editor" onSubmit={e => { e.preventDefault(); void saveColumnName(); }}>
                    <input aria-label="Spaltenname" autoFocus maxLength={80} placeholder={OTHER_PAYMENT.label} value={columnName}
                      onChange={e => setColumnName(e.target.value)} disabled={savingColumnName} />
                    <div><button disabled={savingColumnName}>Speichern</button>
                      <button type="button" disabled={savingColumnName} onClick={() => setColumnName(null)}>Abbrechen</button></div>
                  </form>)}
              </th>)}<th className="num">{DISTANCE.label}</th>
              {DAYS.map((c) => <th key={c.key} className="num">{c.label}</th>)}
            </tr></thead>
            <tbody>
              {sheet.map(({ row: r, input: inp, forecast, displayed }) => {
                return (
                  <tr key={r.resourceId}>
                    <th scope="row" className="sticky">{r.name}</th>
                    <td className="num">{r.payrollHours?.editable ? money(r, MONTHLY_HOURS) : r.payrollHours ? hours(r.payrollHours.minutes) : '–'}</td>
                    <td className="num">{r.payrollHours?.ratePerHour == null ? '–' : eur(r.payrollHours.ratePerHour)}</td>
                    {GROSS.map((c) => <td key={c.key} className="num">
                      {money(r, c, forecast?.[c.key])}
                      {forecast && (c.key === 'umsatzbonus' || value(c, r, inp) !== value(c, r, displayed)) && <div className="muted">Prognose</div>}
                    </td>)}
                    <td className="num strong">{eur(brutto(r, displayed))}{forecast && <div className="muted">Prognose</div>}</td>
                    {moneyCols.map(c => <td key={c.key} className="num">
                      {money(r, c)}
                      {(c.key === 'notfall' || c.key === 'werkzeugGeld') && allowanceNote(r.resourceId, c.key)}
                    </td>)}
                    <td className="num">{numberInput(r, DISTANCE, inp)}</td>
                    {DAYS.map(c => <td key={c.key} className="num">{numberInput(r, c, inp)}</td>)}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5 + GROSS.length + moneyCols.length + DAYS.length} className="muted">Keine Daten für diesen Monat.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr>
              <th className="sticky">Gesamt</th>
              <td className="num">{rows.some(r => r.payrollHours) ? hours(rows.reduce((n, r) => n + (r.payrollHours?.minutes ?? 0), 0)) : '–'}</td>
              <td />
              {GROSS.map((c) => <td key={c.key} className="num">{eur(total(c))}
                {hasForecast && (c.key === 'umsatzbonus' || sheet.some(({ row, input, displayed }) => value(c, row, input) !== value(c, row, displayed))) && <div className="muted">Prognose</div>}
              </td>)}
              <td className="num strong">{eur(sheet.reduce((n, { row, displayed }) => n + brutto(row, displayed), 0))}{hasForecast && <div className="muted">Prognose</div>}</td>
              {moneyCols.map((c) => <td key={c.key} className="num">{eur(total(c))}</td>)}
              <td className="num">{numberText(total(DISTANCE))}</td><td colSpan={DAYS.length} />
            </tr></tfoot>}
          </table>
        </div>
      )}
      {view && (
        <div className="cols notes">
          {absenceNotes.map(({ key, label, automatic, manual, text }) => (
            <label key={key} className="note">{label}
              <textarea rows={4} disabled={frozen} placeholder="Keine Einträge" maxLength={10_000}
                key={JSON.stringify([month, manual ?? null, automatic])} defaultValue={text} onBlur={e => {
                  const edited = e.target.value.trim();
                  if (edited === text) return;
                  if (!edited && manual === undefined) { e.target.value = automatic; return; }
                  void put('_notes', key, edited || null);
                }} />
            </label>
          ))}
        </div>
      )}
      {view && <PayrollPrint month={month} sheet={sheet} moneyColumns={moneyCols} notes={absenceNotes} />}
    </section>
  );
}
