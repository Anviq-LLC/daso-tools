import type { Row } from '../calc/month.ts';
import { DAYS, DISTANCE, GROSS, brutto, fieldValue, value, type Inputs } from '../calc/payroll.ts';
import { fromCents, hours } from './api.ts';

type Column = (typeof GROSS)[number];
type PayrollRow = { row: Row; input: Inputs; forecast: Inputs | null; displayed: Inputs };
const numbers = new Intl.NumberFormat('de-DE', { useGrouping: false, maximumFractionDigits: 6 });
const quantity = (n: number | undefined) => n === undefined ? '–' : numbers.format(n);
const amount = (n: number | null | undefined) => fromCents(n) || '–';
const monthName = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function PayrollPrint({ month, sheet, moneyColumns, notes }: {
  month: string;
  sheet: PayrollRow[];
  moneyColumns: Column[];
  notes: { key: string; label: string; text: string }[];
}) {
  const total = (column: Column) => sheet.reduce((sum, { row, displayed }) => sum + value(column, row, displayed), 0);
  const forecastAmount = ({ row, input, forecast, displayed }: PayrollRow, column: Column) =>
    !!forecast && (column.key === 'umsatzbonus' || value(column, row, input) !== value(column, row, displayed));
  const hasForecast = sheet.some(item => item.forecast !== null);
  const columns = [...GROSS, ...moneyColumns];
  return (
    <article className="tax-print-sheet">
      <header className="tax-print-heading">
        <h1>Lohnabrechnung für den Steuerberater</h1>
        <p><strong>{monthName.format(new Date(month + '-01T00:00:00Z'))}</strong><span>Beträge in Euro · Abwesenheiten in Tagen</span></p>
      </header>
      <table className="tax-print-table" aria-label="Lohnabrechnung">
        <colgroup>
          <col className="tax-print-name" />
          <col className="tax-print-quantity" /><col className="tax-print-quantity" />
          {GROSS.map(column => <col key={column.key} className="tax-print-money" />)}
          <col className="tax-print-brutto" />
          {moneyColumns.map(column => <col key={column.key} className="tax-print-money" />)}
          <col className="tax-print-quantity" />
          {DAYS.map(column => <col key={column.key} className="tax-print-days" />)}
        </colgroup>
        <thead><tr>
          <th scope="col">Mitarbeiter</th><th scope="col" className="num">Stunden</th><th scope="col" className="num">Stundensatz</th>
          {GROSS.map(column => <th key={column.key} scope="col" className="num">{column.label}</th>)}
          <th scope="col" className="num">Gesamt Brutto</th>
          {moneyColumns.map(column => <th key={column.key} scope="col" className="num">{column.label}</th>)}
          <th scope="col" className="num">{DISTANCE.label}</th>
          {DAYS.map(column => <th key={column.key} scope="col" className="num">{column.label}</th>)}
        </tr></thead>
        <tbody>
          {sheet.map(item => {
            const { row, input, displayed, forecast } = item;
            return <tr key={row.resourceId}>
              <th scope="row">{row.name}</th>
              <td className="num">{row.payrollHours ? hours(row.payrollHours.minutes) : '–'}</td>
              <td className="num">{amount(row.payrollHours?.ratePerHour)}</td>
              {GROSS.map(column => <td key={column.key} className="num">
                {amount(fieldValue(column, row, displayed))}
                {forecastAmount(item, column) && <small>Prognose</small>}
              </td>)}
              <td className="num strong">{amount(brutto(row, displayed))}{forecast && <small>Prognose</small>}</td>
              {moneyColumns.map(column => <td key={column.key} className="num">{amount(fieldValue(column, row, input))}</td>)}
              <td className="num">{quantity(fieldValue(DISTANCE, row, input))}</td>
              {DAYS.map(column => <td key={column.key} className="num">{quantity(fieldValue(column, row, input))}</td>)}
            </tr>;
          })}
          {!sheet.length && <tr><td colSpan={5 + columns.length + DAYS.length}>Keine Daten für diesen Monat.</td></tr>}
        </tbody>
        {!!sheet.length && <tfoot><tr>
          <th scope="row">Gesamt</th>
          <td className="num">{sheet.some(({ row }) => row.payrollHours) ? hours(sheet.reduce((sum, { row }) => sum + (row.payrollHours?.minutes ?? 0), 0)) : '–'}</td>
          <td />
          {GROSS.map(column => <td key={column.key} className="num">{amount(total(column))}
            {sheet.some(item => forecastAmount(item, column)) && <small>Prognose</small>}</td>)}
          <td className="num">{amount(sheet.reduce((sum, { row, displayed }) => sum + brutto(row, displayed), 0))}
            {hasForecast && <small>Prognose</small>}</td>
          {moneyColumns.map(column => <td key={column.key} className="num">{amount(total(column))}</td>)}
          <td className="num">{quantity(total(DISTANCE))}</td>
          <td colSpan={DAYS.length} />
        </tr></tfoot>}
      </table>
      <section className="tax-print-absences" aria-label="Abwesenheiten">
        {notes.map(note => <div key={note.key}><h2>{note.label}</h2><p>{note.text || '–'}</p></div>)}
      </section>
    </article>
  );
}
