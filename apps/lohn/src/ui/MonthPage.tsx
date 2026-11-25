import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, eur, hours, type MonthView } from './api.ts';
import { MoneyInput } from './MoneyInput.tsx';
import { SubBonus } from './SubBonus.tsx';
import { RevenueBonus } from './RevenueBonus.tsx';
import { ReopenMonth } from './ReopenMonth.tsx';
import type { NuProjectRow, Row } from '../calc/month.ts';
import { summarizeEmployeePay } from '../calc/payroll.ts';
import { fullMonth, type NuPeriods } from '../calc/nu-periods.ts';
import { HOURS_WITHOUT_REVENUE_HINT, LABELS, MANUAL_HOURS_HINT, sortCodes } from '../calc/labels.ts';
import { dow } from '../import/plan.ts';
import logo from './logo.png';
import './employee-print.css';

const visibleHints = (warnings: string[]) => warnings.filter(warning =>
  warning !== 'Keine Lohngruppe hinterlegt.' && !warning.endsWith(MANUAL_HOURS_HINT),
);
const shortDay = (day: string) => `${WEEKDAY[new Date(day + 'T00:00:00Z').getUTCDay()]} ${day.slice(8)}.${day.slice(5, 7)}.`;
const displayedRevenue = (row: Row) => row.overview?.revenue ?? row.metrics.revenue;
const dailyRevenue = (day: NonNullable<Row['calendar']>[number]) =>
  day.revenue.reduce((total, entry) => total + entry.cents, 0);

function employeeRevenue(row: Row) {
  if (row.sub || row.weeks) return { regular: displayedRevenue(row), saturday: 0 };
  const saturday = row.calendar
    ? row.calendar.filter(day => dow(day.day) === 6).reduce((total, day) => total + dailyRevenue(day), 0)
    : row.metrics.saturdayRevenue;
  const regular = row.overview ? row.overview.revenue - saturday : row.metrics.revenue;
  return { regular, saturday };
}

function revenueAmounts(regular: number, saturday: number) {
  return <>{eur(regular)}
    {!!saturday && <div className="muted">Samstagsumsatz {eur(saturday)}</div>}</>;
}
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const monthName = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const STATUS: Record<string, string> = { offen: 'In Berechnung', pruefung: 'Prüfung offen', freigabe: 'Zur Freigabe', freigegeben: 'Freigegeben', abgeschlossen: 'Abgeschlossen' };
const NEXT: Record<string, [string, string] | undefined> = {
  offen: ['pruefung', 'Zur Prüfung geben'], pruefung: ['freigabe', 'Zur Freigabe geben'], freigabe: ['freigegeben', 'Freigeben'], freigegeben: ['abgeschlossen', 'Abschließen'],
};

function printEmployeeMonth(name: string, month: string) {
  const title = document.title;
  document.title = `${month} Monatsansicht ${name}`;
  document.body.classList.add('employee-month-print');
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('employee-month-print');
    document.title = title;
  }, { once: true });
  window.print();
}

export function MonthPage({ month, setMonth, role }: { month: string; setMonth: (m: string) => void; role: string }) {
  const [view, setView] = useState<MonthView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  async function copyHint(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Hinweis kopiert.');
    } catch {
      setCopyStatus('Der Hinweis konnte nicht kopiert werden.');
    }
  }

  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setBusy(true); setError('');
    try { const v = await api<MonthView>(`/api/months/${month}`); if (n === seq.current) setView(v); }
    catch (e) { if (n === seq.current) { setError((e as Error).message); setView(null); } }
    finally { if (n === seq.current) setBusy(false); }
  }, [month]);
  useEffect(() => { setOpen(null); load(); }, [load]);

  const move = async (to: string) => {
    try { await api(`/api/months/${month}/status`, 'POST', { to }); await load(); } catch (e) { setError((e as Error).message); }
  };

  const codes = view ? sortCodes(view.result.rows.flatMap((r) => r.lines.map((l) => l.code))).map((c) => [c, LABELS[c] ?? c] as const) : [];
  const sel = view?.result.rows.find((r) => r.resourceId === open);
  const selectedSub = !!(sel?.sub || sel?.weeks);
  const revenueTotals = view?.result.rows.reduce((total, row) => {
    const revenue = employeeRevenue(row);
    return { regular: total.regular + revenue.regular, saturday: total.saturday + revenue.saturday };
  }, { regular: 0, saturday: 0 });
  const selectedHints = sel ? visibleHints(sel.warnings) : [];
  const next = view ? NEXT[view.status] : undefined;

  return (
    <section className="month-page">
      <div className="toolbar">
        <label>Monat <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        {view && <span className={`chip s-${view.status}`} data-testid="status">{STATUS[view.status]}</span>}
        {view?.frozen && <span className="muted">Schreibgeschützt, freigegeben von {view.releasedBy}</span>}
        <span className="spacer" />
        {view && next && <button className="primary" onClick={() => move(next[0])}>{next[1]}</button>}
        {view?.frozen && view.result.month === month && role === 'gf' && <ReopenMonth key={month} month={month} onReopened={load} />}
        {view && (view.status === 'freigegeben' || view.status === 'abgeschlossen') && <a className="btn" href={`/api/months/${month}/export.csv`}>Export CSV</a>}
        <button onClick={() => window.print()}>Drucken</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
      {busy && <p className="muted">Berechne ...</p>}
      {view && (
        <>
          <div className="scroll">
            <table className="grid" data-testid="month-table">
              <thead>
                <tr>
                  <th className="sticky">Mitarbeiter</th><th className="num">Stunden</th><th className="num">Umsatz</th>
                  {codes.map(([c, l]) => <th key={c} className="num">{l}</th>)}
                  <th className="num">Summe</th><th className="num">Spesen (steuerfrei)</th><th className="num">km</th><th>Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {view.result.rows.map((r) => {
                  const hints = visibleHints(r.warnings);
                  const missingRevenue = hints.some(hint => hint.endsWith(HOURS_WITHOUT_REVENUE_HINT));
                  const revenue = employeeRevenue(r);
                  return (
                    <tr key={r.resourceId} className={open === r.resourceId ? 'on' : ''} onClick={() => setOpen(open === r.resourceId ? null : r.resourceId)}>
                      <th className="sticky" scope="row"><button className="link" aria-expanded={open === r.resourceId}>{r.name}</button></th>
                      <td className="num">{hours(r.metrics.workMinutes)}</td>
                      <td className="num">{revenueAmounts(revenue.regular, revenue.saturday)}</td>
                      {codes.map(([c]) => { const v = r.lines.filter((l) => l.code === c).reduce((n, l) => n + l.cents, 0); return <td key={c} className={'num' + (v < 0 ? ' neg' : '')}>{r.lines.some((l) => l.code === c) ? eur(v) : ''}</td>; })}
                      <td className="num strong">{eur(r.payout)}</td>
                      <td className="num">{eur(r.spesen)}</td>
                      <td className="num">{r.km.toFixed(0)}</td>
                      <td>{hints.length > 0 && <button type="button" className="badge copy-hint" title={hints.join('\n')} aria-label={`Hinweise für ${r.name} kopieren`}
                        onClick={e => { e.stopPropagation(); void copyHint(hints.join('\n')); }}>
                        {hints.length}{missingRevenue && ` · ${HOURS_WITHOUT_REVENUE_HINT}`}
                      </button>}</td>
                    </tr>
                  );
                })}
                {!view.result.rows.length && <tr><td colSpan={codes.length + 7} className="muted">Keine Daten für diesen Monat.</td></tr>}
              </tbody>
              {view.result.rows.length > 0 && (
                <tfoot><tr>
                  <th className="sticky">Gesamt</th><td className="num">{hours(view.result.rows.reduce((n, r) => n + r.metrics.workMinutes, 0))}</td>
                  <td className="num">{revenueAmounts(revenueTotals?.regular ?? 0, revenueTotals?.saturday ?? 0)}</td>
                  {codes.map(([c]) => <td key={c} className="num">{eur(view.result.rows.reduce((n, r) => n + r.lines.filter((l) => l.code === c).reduce((a, l) => a + l.cents, 0), 0))}</td>)}
                  <td className="num strong">{eur(view.result.rows.reduce((n, r) => n + r.payout, 0))}</td>
                  <td className="num">{eur(view.result.rows.reduce((n, r) => n + r.spesen, 0))}</td><td className="num">{view.result.rows.reduce((n, r) => n + r.km, 0).toFixed(0)}</td><td />
                </tr></tfoot>
              )}
            </table>
          </div>
          {sel && (
            <aside className="detail" aria-label={`Details ${sel.name}`}>
              <h2 className="employee-print-hide">{sel.name}</h2>
              <EmployeePayLines row={sel} />
              {selectedSub && <div className="sub-details">
                <div>
                  <p>Gesamtumsatz <strong>{eur(displayedRevenue(sel))}</strong></p>
                  <SubWeeks key={`${month}:${sel.resourceId}`} weeks={sel.weeks ?? []} />
                </div>
                <SubBonus key={`${month}:${sel.resourceId}`} month={month} resourceId={sel.resourceId} frozen={view.frozen} />
              </div>}
              {sel.calendar && <EmployeeCalendar row={sel} month={view.result.month} days={sel.calendar} frozen={view.frozen} onCopy={copyHint} />}
              {!selectedSub && <RevenueBonus key={`${month}:${sel.resourceId}`} month={month} row={sel} frozen={view.frozen} onDone={load} />}
              {sel.calendar && sel.lines.length > 0 && <section className="employee-print-only employee-print-pay-lines">
                <h3>Erfasste Lohnpositionen</h3>
                <EmployeePayLines row={sel} print />
              </section>}
              {selectedHints.length > 0 && <ul className="warnlist">{selectedHints.map((w, i) => <li key={i}><button type="button" className="copy-hint" title="Hinweis kopieren" onClick={() => void copyHint(w)}>{w}</button></li>)}</ul>}
            </aside>
          )}
          {(view.result.nuProjects !== undefined || view.result.nuProjectsError || view.result.nu.length > 0) &&
            <NuTable key={month} month={month} view={view} onDone={load} frozen={view.frozen} />}
        </>
      )}
    </section>
  );
}

function EmployeePayLines({ row, print = false }: { row: Row; print?: boolean }) {
  return <table className={print ? undefined : 'employee-print-hide'}>
    {print && <thead><tr><th>Position</th><th>Berechnung</th><th className="num">Betrag</th></tr></thead>}
    <tbody>
      {row.lines.map((line, index) => <tr key={index}><td>{line.label}</td><td className="muted">{line.note}</td><td className="num">{eur(line.cents)}</td></tr>)}
      <tr className="strong"><td colSpan={2}>{print ? 'Summe der Positionen' : 'Summe'}</td><td className="num">{eur(row.payout)}</td></tr>
    </tbody>
  </table>;
}

function EmployeeCalendar({ row, month, days, frozen, onCopy }: {
  row: Row; month: string; days: NonNullable<Row['calendar']>; frozen: boolean; onCopy: (text: string) => Promise<void>;
}) {
  const { name, metrics: { replacement } } = row;
  const showTravel = days.some(day => day.travelMinutes !== undefined);
  const totalWork = days.reduce((sum, day) => sum + (day.absence ? 0 : day.workMinutes), 0);
  const totalTravel = days.reduce((sum, day) => sum + (day.travelMinutes ?? 0), 0);
  const totalRevenue = days.filter(day => dow(day.day) !== 6).reduce((sum, day) => sum + dailyRevenue(day), 0);
  const totalSaturday = days.filter(day => dow(day.day) === 6).reduce((sum, day) => sum + dailyRevenue(day), 0);
  const totalProjected = frozen ? 0 : days.reduce((sum, day) => sum + (day.projectedRevenue ?? 0), 0);
  const pay = row.paySummary ?? summarizeEmployeePay(row);
  const forecast = frozen ? null : pay.forecast;
  return <section className="employee-calendar">
    <header className="employee-print-only employee-print-heading">
      <div className="employee-print-contact">
        <img src={logo} alt="" />
        <span>DaSo Lüftungsbau GmbH</span>
      </div>
      <h1>Monatsübersicht</h1>
      <div className="employee-print-period"><strong>{name}</strong><span>{monthName.format(new Date(month + '-01T00:00:00Z'))}</span></div>
      <dl className="employee-print-figures">
        <div><dt>Arbeitszeit</dt><dd>{hours(totalWork)} h</dd></div>
        {showTravel && <div><dt>Anfahrt</dt><dd>{hours(totalTravel)} h</dd></div>}
        <div><dt>Regulärer Umsatz</dt><dd>{eur(totalRevenue)}</dd></div>
        <div className="employee-print-gross"><dt>Bruttolohn{forecast ? ' (Prognose)' : ''}</dt><dd>{eur((forecast ?? pay.actual).gross)}</dd></div>
      </dl>
    </header>
    <div className="employee-calendar-heading">
      <h3><span className="employee-print-hide">Monatsansicht</span><span className="employee-print-only">Tagesübersicht</span></h3>
      <button type="button" className="employee-print-button" onClick={() => printEmployeeMonth(name, month)}>Monatsansicht als PDF</button>
    </div>
    <div className="scroll"><table className="cal" aria-label={`Monatsansicht ${name}`}>
      <colgroup>
        <col className="cal-date-col" />
        {showTravel && <col className="cal-hours-col" />}
        <col className="cal-hours-col" />
        {showTravel && <col className="cal-hours-col" />}
        <col className="cal-status-col" />
        <col />
        <col className="cal-revenue-col" />
      </colgroup>
      <thead><tr><th>Tag</th>{showTravel && <th className="num">Gesamt (h)</th>}
        <th className="num">Arbeitszeit (h)</th>
        {showTravel && <th className="num">Anfahrt (h)</th>}
        <th>Status</th><th>Projekt</th><th className="num">Umsatz</th></tr></thead>
      <tbody>
        {days.filter(day => day.workMinutes || day.travelMinutes || day.revenue.length || day.absence || day.flag ||
          day.replacementRevenue !== undefined || (!frozen && day.projectedRevenue !== undefined)).map(day => {
          const worked = day.absence ? 0 : day.workMinutes;
          const travel = day.travelMinutes ?? 0;
          const total = worked + travel;
          const notes = day.note ? day.note.split(', ') : [];
          const copyableNote = notes.filter(note => note !== MANUAL_HOURS_HINT).join(', ');
          return <tr key={day.day} className={`${day.flag} ${dow(day.day) === 6 ? 'cal-saturday' : ''}`} title={day.note}>
            <th scope="row">{shortDay(day.day)}</th>
            {showTravel && <td className="num strong">{total ? hours(total) : ''}</td>}
            <td className="num">{worked ? hours(worked) : ''}</td>
            {showTravel && <td className="num">{travel ? hours(travel) : ''}</td>}
            <td className="cal-note">{day.absence || <>
              {copyableNote && <>
                <button type="button" className="copy-hint employee-print-hide" title="Hinweis kopieren" onClick={() => void onCopy(copyableNote)}>{copyableNote}</button>
                <span className="employee-print-only">{copyableNote}</span>
              </>}
              {notes.includes(MANUAL_HOURS_HINT) && <div>{MANUAL_HOURS_HINT}</div>}
            </>}</td>
            <td className="cal-project">{[...new Set(day.revenue.map(row => row.label))].join(', ')}</td>
            <td className="num">
              {!!day.revenue.length && <div>{dow(day.day) === 6 && <small className="muted">Samstagsumsatz </small>}{eur(dailyRevenue(day))}</div>}
              {day.replacementRevenue !== undefined && <div><small className="muted">Fiktiv</small> {eur(day.replacementRevenue)}</div>}
              {!frozen && day.projectedRevenue !== undefined && <div><small className="muted">Prognose</small> {eur(day.projectedRevenue)}</div>}
            </td>
          </tr>;
        })}
      </tbody>
      <tfoot><tr><th scope="row">Summe</th>{showTravel && <td className="num">{hours(totalWork + totalTravel)}</td>}
        <td className="num">{hours(totalWork)}</td>
        {showTravel && <td className="num">{hours(totalTravel)}</td>}
        <td colSpan={2} className="num">{totalSaturday ? 'Regulärer Umsatz' : 'Umsatz'}{replacement ? ' inkl. Ersatz' : ''}</td>
        <td className="num">{eur(totalRevenue + replacement)}</td></tr>
        {!!totalSaturday && <tr><th scope="row" colSpan={showTravel ? 6 : 4} className="num">Samstagsumsatz</th>
          <td className="num">{eur(totalSaturday)}</td></tr>}
        {!!totalProjected && <tr><th scope="row" colSpan={showTravel ? 6 : 4} className="num">Prognose Monatsende inkl. Ersatz</th>
          <td className="num">{eur(totalRevenue + replacement + totalProjected)}</td></tr>}
      </tfoot>
    </table></div>
  </section>;
}

function SubWeeks({ weeks }: { weeks: NonNullable<Row['weeks']> }) {
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  return <section className="sub">
    <h3>SUB-Wochenauswertung</h3>
    {weeks.length === 0 ? <p className="muted">Für diesen Monat sind keine Stunden erfasst.</p> : (
      <div className="scroll"><table>
        <thead><tr><th>Woche</th><th className="num">Gearbeitet (h)</th><th className="num">Anfahrt (h)</th><th className="num">Kosten</th></tr></thead>
        <tbody>{weeks.map(week => (
          <Fragment key={week.kw}>
            <tr>
              <th scope="row"><button type="button" className="link" aria-expanded={openWeek === week.kw}
                onClick={() => setOpenWeek(openWeek === week.kw ? null : week.kw)}>
                {week.kw.replace('-W', ' · KW ')}
              </button></th>
              <td className="num">{hours(week.workMinutes)}</td><td className="num">{hours(week.travelMinutes)}</td>
              <td className="num">{eur(week.cents)}</td>
            </tr>
            {openWeek === week.kw && <tr className="sub-week-days"><td colSpan={4}>
              {week.days?.length ? <table aria-label={`Tagesübersicht ${week.kw}`}>
                <thead><tr><th>Tag</th><th>Bauvorhaben</th><th className="num">Gearbeitet (h)</th><th className="num">Anfahrt (h)</th></tr></thead>
                <tbody>{week.days.map(day => (
                  <tr key={day.day}>
                    <th scope="row">{shortDay(day.day)}</th>
                    <td>{day.projects.join(', ') || '–'}</td>
                    <td className="num">{hours(day.workMinutes)}</td><td className="num">{hours(day.travelMinutes)}</td>
                  </tr>
                ))}</tbody>
              </table> : <p className="muted">Für diese Woche sind nur die Summen gespeichert.</p>}
            </td></tr>}
          </Fragment>
        ))}</tbody>
      </table></div>
    )}
  </section>;
}

function NuTable({ month, view, onDone, frozen }: { month: string; view: MonthView; onDone: () => void; frozen: boolean }) {
  const [costError, setCostError] = useState('');
  const rows = view.result.nuProjectsError ? [] : view.result.nuProjects ?? view.result.nu;
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api<{ id: string; name: string }[]>('/api/terms').then(setPeople).catch(() => {}); }, []);
  const save = async (row: NuProjectRow, value: number | null) => {
    if (value === null || value === (row.otherCost ?? 0)) return;
    setCostError('');
    try {
      await api('/api/nu-costs', 'PUT', { month, projectId: row.projectId, cents: value });
      onDone();
    } catch (error) {
      setCostError((error as Error).message);
    }
  };
  return (
    <section className="nu">
      <h2>Nachunternehmer-Projekte</h2>
      {view.result.nuProjectsError && <p className="error" role="alert">Nachunternehmerprojekte konnten nicht geladen werden. {view.result.nuProjectsError}</p>}
      {costError && <p className="error" role="alert">{costError}</p>}
      {!view.result.nuProjectsError && rows.length === 0 && <p className="muted">Keine Nachunternehmerprojekte in diesem Monat.</p>}
      {rows.length > 0 && <div className="scroll"><table>
        <thead><tr><th>Projekt</th><th className="num">NU-Umsatz</th><th className="num">NU-Kosten</th>{!frozen && <th>Sonstige Kosten</th>}<th className="num">Gewinn / Verlust</th><th className="num">Bonus 10 %</th><th colSpan={2}>Bonusbeteiligung</th></tr></thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.projectId}>
              <td>{n.issues ? n.projectName : n.projectName.replace(/^(?:ohne Nummer|\d[\d/-]*)\s+/i, '')}
                {n.issues?.length ? <details><summary>Offene Aufmaßwerte</summary><ul>{n.issues.map((item, index) =>
                  <li key={index}>{item.day}{item.end > item.day ? ' bis ' + item.end : ''} · {item.team} · {item.reason}{item.reportId && <> · <span title={item.reportId}>Aufmaß {item.reportId.slice(0, 8)}</span></>}</li>)}</ul></details> : null}
              </td>
              <td className="num">{n.revenue === null ? 'offen' : eur(n.revenue)}{n.revenue !== null && n.missingRevenue ? <div className="muted">teilweise offen</div> : null}</td>
              <td className="num">{n.cost === null ? 'offen' : eur(n.cost)}{n.cost !== null && n.missingCosts ? <div className="muted">teilweise offen</div> : null}</td>
              {!frozen && <td><MoneyInput aria-label={`Sonstige Kosten ${n.projectName}`} cents={n.otherCost || null} onCommit={value => save(n, value)} /></td>}
              <td className={'num' + ((n.profit ?? 0) < 0 ? ' neg' : '')}>
                {n.profit === null ? 'offen' : eur(n.profit)}
                {n.profit !== null && (n.missingCosts || n.missingRevenue) ? <div className="muted" title="Berechnet mit den aktuell erfassten Beträgen">vorläufig</div> : null}
              </td><td className="num">{n.profit === null ? 'offen' : eur(n.bonus)}
                {n.shares?.pending && <div className="muted">Aufteilung offen. Tagesstunden fehlen.</div>}
                {!!n.shares?.unassigned && !n.shares.pending && <div className="muted">{eur(n.shares.unassigned)} ohne Zeitraum</div>}
              </td>
              <td colSpan={2}><NuAssignment key={JSON.stringify([n.firstId, n.secondId, n.periods])}
                month={month} row={n} people={people} frozen={frozen} onDone={onDone} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>}
    </section>
  );
}

function NuAssignment({ month, row, people, frozen, onDone }: {
  month: string; row: NuProjectRow; people: { id: string; name: string }[]; frozen: boolean; onDone: () => void;
}) {
  const full = fullMonth(month);
  const initial = row.periods ?? { first: full, second: full };
  const [periods, setPeriods] = useState<NuPeriods>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(periods) !== JSON.stringify(initial);
  const valid = [periods.first, periods.second].every(p => p.from >= full.from && p.to <= full.to && p.from <= p.to);
  const save = async (firstId: string | null, secondId: string | null, dates: NuPeriods) => {
    setError(''); setBusy(true);
    try {
      await api('/api/nu-assign', 'PUT', { month, projectId: row.projectId, firstId, secondId, periods: dates });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <div className="nu-recipients">
      {(['first','second'] as const).map(which => {
        const first = which === 'first';
        const id = first ? row.firstId : row.secondId;
        const other = first ? row.secondId : row.firstId;
        return <div key={which}>
          <label>{first ? '1. Mitarbeiter' : '2. Mitarbeiter'}
            <select aria-label={(first ? 'Bonus an ' : '2. Mitarbeiter ') + row.projectName}
              disabled={frozen || busy || (!first && !row.firstId)} value={id ?? ''} onChange={e => {
                const chosen = e.target.value || null;
                void save(first ? chosen : row.firstId, first ? chosen && row.secondId : chosen, initial);
              }}>
              <option value="">{first ? 'Niemand' : 'Keiner'}</option>
              {people.filter(p => p.id !== other || p.id === id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {row.secondId && <div className="nu-range">
            {(['from','to'] as const).map(edge => <label key={edge}>{edge === 'from' ? 'Von' : 'Bis'}
              <input type="date" min={full.from} max={full.to} value={periods[which][edge]} disabled={frozen || busy}
                aria-label={(first ? '1.' : '2.') + ' Mitarbeiter ' + (edge === 'from' ? 'von ' : 'bis ') + row.projectName}
                onChange={e => setPeriods({ ...periods, [which]: { ...periods[which], [edge]: e.target.value } })} />
            </label>)}
            {row.shares && <small>{eur(row.shares[which])}</small>}
          </div>}
        </div>;
      })}
    </div>
    {row.secondId && !frozen && changed && <button type="button" disabled={busy || !valid}
      onClick={() => void save(row.firstId, row.secondId, periods)}>Zeiträume speichern</button>}
    {error && <div className="error" role="alert">{error}</div>}
  </>;
}
