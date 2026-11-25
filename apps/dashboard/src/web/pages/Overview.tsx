import { useEffect, useMemo, useState } from 'react';
import { api, dayLabel, download, money, monthLabel } from '../api.ts';
import { PeriodCalendar } from '../PeriodCalendar.tsx';
import { RevenueChart } from '../RevenueChart.tsx';
import { overviewRevenue, overviewRevenueForecast, type OverviewDay } from '../../calc/overview.ts';
import type { AccountingMonth } from '../../calc/accounting-history.ts';
import { dashboardYear } from '../../calc/dashboard-year.ts';
import type { MonthData } from '../types.ts';

type Calendar = { date: string; daily: OverviewDay[]; forecast: number | null };
type TraceRow = { report_id: string; label: string; customer_cents: number; binding: boolean; estimated: boolean };
type Trace = { day: string; own: (TraceRow & { name: string })[]; sub: (TraceRow & { firm: string; team: string })[] };
const shortMonth = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });
const monthNumbers = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function RevenueTiles({ figures, total, period, forecast, targets }: {
  figures: ReturnType<typeof overviewRevenue>; total: number | null; period: string;
  forecast: ReturnType<typeof overviewRevenueForecast>; targets: number[];
}) {
  return <div className="tiles">
    <div className="tile"><small>Gesamtumsatz · {period}</small><strong>{money(total)}</strong>
      {forecast.total !== null && <small>Prognose Gesamtumsatz {money(forecast.total)}</small>}</div>
    <div className="tile"><small>Umsatz Mitarbeiter</small><strong>{money(figures.hasRevenue ? figures.own : null)}</strong>
      {forecast.own !== null && <small>Prognose Umsatz Mitarbeiter {money(forecast.own)}</small>}</div>
    <div className="tile"><small>Umsatz Nachunternehmer</small><strong>{money(figures.hasRevenue ? figures.sub : null)}</strong>
      {forecast.sub !== null && <small>Prognose Umsatz Nachunternehmer {money(forecast.sub)}</small>}</div>
    <div className="tile"><small>Tages-Soll je Kopf</small><strong>{targets.length > 1 ? money(Math.min(...targets)) + ' – ' + money(Math.max(...targets)) : money(targets[0])}</strong>
      <small>Ø Umsatz pro Kopf und Tag</small>
      <small className="overview-staff-rate">Gesamt {money(figures.totalPerHead)}</small>
      <small className="overview-staff-rate"><abbr title="Nachunternehmer">NU</abbr> {money(figures.subPerHead)}</small>
      <small className="overview-staff-rate"><abbr title="Monteur">M</abbr> {money(figures.mPerHead)}</small>
      <small className="overview-staff-rate"><abbr title="Obermonteur">OM</abbr> {money(figures.omPerHead)}</small></div>
  </div>;
}

// Costs, profit and the notes only exist for one month, so they sit below the calendar views.
function MonthDetails({ d, month }: { d: MonthData; month: string }) {
  const [changes, setChanges] = useState<any[] | null>(null);
  const f = d.forecast;
  const subCost = d.subs.reduce((a, x) => a + x.cost, 0);
  const warnings = [...d.warnings, ...d.ingestWarnings];
  return <>
    <div className="tiles">
      <div className="tile"><small>Pipeline (noch nicht verbindlich)</small><strong>{money(d.pipeline.total)}</strong><small>Mitarbeiter {money(d.pipeline.own)} · Nachunternehmer {money(d.pipeline.sub)}</small></div>
      <div className="tile"><small>Mitarbeiterumsatz 90 %</small><strong>{money(d.ownEmployeeValue)}</strong><small>Ansicht auf den Mitarbeiterumsatz, kein zusätzlicher Erlös</small></div>
      <div className="tile"><small>Kosten Nachunternehmer</small><strong>{money(subCost)}</strong></div>
      <div className="tile"><small>Gemeinkosten</small><strong>{money(d.costs.overhead)}</strong><small>Fix {money(d.costs.fixedTotal)} · übergreifend {money(d.costs.central)}</small></div>
      <div className="tile"><small>Gewinn gesamt (Schätzung)</small><strong>{d.profit === null ? 'ohne Berechtigung' : money(d.profit)}</strong><small>{d.profit === null ? 'Personalkosten nicht freigegeben' : 'inkl. geschätzter Personalkosten ' + money(d.costs.personnel)}</small></div>
      {d.costForecast !== null && <div className="tile"><small>Prognose Kosten</small><strong>{money(d.costForecast)}</strong><small>Fix voll, variabel nach Umsatz</small></div>}
    </div>
    {warnings.length > 0 && <div className="warn"><strong>Hinweise</strong><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
    {f && <section className="card"><h2>Annahmen der Prognose</h2><ul>{f.assumptions.map((a, i) => <li key={i}>{a}</li>)}<li>Kostenprognose: Fixkosten voll, variable Kosten im Verhältnis zum prognostizierten Umsatz.</li></ul>
      <small className="muted">Stand {d.dataDate}{d.lastIngest ? `, Daten zuletzt abgeglichen ${new Date(d.lastIngest).toLocaleString('de-DE')}` : ''}. Freigabe: {d.approval === 'saved' ? 'gespeichertes Aufmaß zählt' : 'Kundenfreigabe zählt'}.</small></section>}
    <section className="card">
      <div className="row"><h2>Änderungsprotokoll</h2><span className="spacer" /><button className="btn" onClick={() => api<any[]>(`/api/changes?month=${month}`).then(setChanges)}>Anzeigen</button></div>
      {changes && (changes.length ? <div className="scroll"><table><thead><tr><th>Zeitpunkt</th><th>Tag</th><th>Bereich</th><th>Aufmaß</th><th>Vorher</th><th>Nachher</th><th>Grund</th></tr></thead><tbody>
        {changes.map((c, i) => <tr key={i}><td>{new Date(c.at).toLocaleString('de-DE')}</td><td>{c.day}</td><td>{c.scope}</td><td>{String(c.report_id).slice(0, 8)}</td><td>{money(c.before_cents)}</td><td>{money(c.after_cents)}</td><td>{c.reason}</td></tr>)}
      </tbody></table></div> : <p className="muted">Keine nachträglichen Änderungen in diesem Monat.</p>)}
    </section>
  </>;
}

export function Overview({ selectedMonth, onPeriodChange, accounting }: {
  selectedMonth: string; onPeriodChange: (period: string) => void; accounting: Map<string, AccountingMonth>;
}) {
  const year = selectedMonth.slice(0, 4);
  const [wholeYear, setWholeYear] = useState(false);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<{ year: string; data: Calendar } | null>(null);
  const [error, setError] = useState('');
  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceError, setTraceError] = useState('');
  const [monthData, setMonthData] = useState<{ month: string; data: MonthData } | null>(null);
  const data = loaded?.year === year ? loaded.data : null;
  const date = data?.date ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format();
  const currentMonth = date.slice(0, 7);
  const days = useMemo(() => data?.daily ?? [], [data]);
  const selectedDays = useMemo(() => (wholeYear ? days : days.filter((d) => d.day.startsWith(selectedMonth))), [days, selectedMonth, wholeYear]);
  const label = wholeYear ? year : monthLabel(selectedMonth);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<Calendar>('/api/overview-calendar?year=' + year, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setLoaded({ year, data: d }); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [year, reload]);
  useEffect(() => {
    if (wholeYear) return;
    const controller = new AbortController();
    api<MonthData>('/api/month?month=' + selectedMonth, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setMonthData({ month: selectedMonth, data: d }); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selectedMonth, wholeYear, reload]);

  const months = useMemo(() => monthNumbers.map((n) => {
    const month = year + '-' + n;
    const totals = overviewRevenue(days.filter((d) => d.day.startsWith(month)));
    const book = accounting.get(month);
    const revenue = (totals.hasRevenue ? totals.total : null) ?? book?.revenue ?? null;
    return { month, book, totals, revenue, revenueThrough: null };
  }), [year, days, accounting]);
  const annual = dashboardYear(months, date, data?.forecast ?? null);
  const point = annual.points.find((p) => p.month === selectedMonth);
  const forecastTotal = wholeYear ? annual.yearForecast : point?.kind === 'ist' ? null : point?.revenue ?? null;
  const figures = overviewRevenue(selectedDays);
  const forecast = overviewRevenueForecast(forecastTotal, !wholeYear && selectedMonth > currentMonth ? overviewRevenue(days) : figures);
  const monthTotal = months.find((r) => r.month === selectedMonth)?.revenue ?? null;
  const tableDays = selectedDays.filter((d) => d.hasRevenue || d.heads);
  const targets = [...new Set(selectedDays.flatMap((d) => (d.target === null ? [] : [d.target])))];
  const points = wholeYear
    ? months.map(({ month, totals }) => ({ id: month, label: shortMonth.format(new Date(month + '-15T12:00:00Z')), detail: monthLabel(month), own: totals.own, sub: totals.sub }))
    : selectedDays.map((d) => ({ id: d.day, label: d.day.slice(8), detail: dayLabel(d.day), own: d.own, sub: d.sub }));

  const open = (day: string) => { setTraceError(''); api<Trace>('/api/trace?day=' + day).then(setTrace).catch((e) => setTraceError(e.message)); };
  const details = !wholeYear && monthData?.month === selectedMonth ? monthData.data : null;

  return <>
    <PeriodCalendar title="Umsatzkalender" year={year} month={wholeYear ? '' : selectedMonth.slice(5)}
      onMonth={(value) => { setWholeYear(!value); setTrace(null); setTraceError(''); if (value) onPeriodChange(year + '-' + value); }}
      onYear={(value) => { onPeriodChange(value + selectedMonth.slice(4)); setTrace(null); setTraceError(''); }}
      onReload={() => setReload((v) => v + 1)} />
    <RevenueChart points={points} title={wholeYear ? 'Umsatz je Monat' : 'Umsatz je Tag'} />
    {error && <p className="card err" role="alert">{error}</p>}
    {!data && !error && <p className="card" role="status">Umsatzdaten werden geladen …</p>}
    {(data || accounting.size > 0) && <RevenueTiles figures={figures} total={wholeYear ? annual.total : monthTotal} period={label} forecast={forecast} targets={targets} />}
    {data && <section className="card">
      <div className="row"><h2>Tage · {label}</h2><span className="spacer" /><button className="btn" onClick={() => download('/api/export?what=overview-days&year=' + year + (wholeYear ? '' : '&month=' + selectedMonth))}>CSV</button></div>
      <div className="scroll"><table>
        <thead><tr><th>Tag</th><th>Umsatz Monteur</th><th>Umsatz Obermonteur</th><th>Umsatz Nachunternehmer</th><th>Gesamt</th><th>Köpfe</th>
          <th>Umsatz/Kopf Mitarbeiter</th><th>Umsatz/Kopf Nachunternehmer</th><th>Soll-Ist je Kopf</th></tr></thead>
        <tbody>{tableDays.map((d) => {
          const delta = d.perHead !== null && d.target !== null ? d.perHead - d.target : null;
          return <tr key={d.day} className="click" onClick={() => open(d.day)}>
            <td><button type="button" className="sub-firm-toggle" onClick={(e) => { e.stopPropagation(); open(d.day); }}>{dayLabel(d.day)}</button></td>
            <td>{money(d.ownRoles.m.revenue)}</td><td>{money(d.ownRoles.om.revenue)}</td><td>{money(d.sub)}</td>
            <td>{money(d.total)}</td><td>{d.subHeadsMissing ? '–' : d.heads}</td>
            <td>{money(d.ownPerHead)}</td><td>{money(d.subPerHead)}</td><td className={delta === null ? undefined : delta >= 0 ? 'ok' : 'err'}>{money(delta)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {traceError && <p className="err" role="alert">{traceError}</p>}
    </section>}
    {trace && (wholeYear || trace.day.startsWith(selectedMonth)) && trace.day.startsWith(year) && <section className="card">
      <div className="row"><h2>Nachweis {dayLabel(trace.day)}</h2><span className="spacer" /><button className="btn" onClick={() => setTrace(null)}>Schließen</button></div>
      <div className="scroll"><table><thead><tr><th>Aufmaß-ID</th><th>Projekt</th><th>Wer</th><th>Kundenumsatz</th><th>Status</th></tr></thead><tbody>
        {[...trace.own.map((r) => ({ ...r, who: r.name })), ...trace.sub.map((r) => ({ ...r, who: r.firm + ' ' + r.team }))].map((r, i) =>
          <tr key={i}><td title={r.report_id}>{String(r.report_id).slice(0, 8)}</td><td>{r.label}</td><td>{r.who}</td><td>{money(r.customer_cents)}</td>
            <td>{r.binding ? 'verbindlich' : 'Pipeline'} {r.estimated && <span className="chip est">auf Tage verteilt</span>}</td></tr>)}
      </tbody></table></div>
      <small className="muted">Mitarbeiterzeilen sind Anteile desselben Kundenumsatzes: ein Aufmaß zählt im Gesamtumsatz nur einmal.</small>
    </section>}
    {details && <MonthDetails d={details} month={selectedMonth} />}
  </>;
}
