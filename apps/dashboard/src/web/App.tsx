import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, monthLabel, shiftMonth } from './api.ts';
import type { MonthData, Me } from './types.ts';
import { Overview } from './pages/Overview.tsx';
import { People } from './pages/People.tsx';
import { Subs } from './pages/Subs.tsx';
import { Projects } from './pages/Projects.tsx';
import { Year } from './pages/Year.tsx';
import { Costs } from './pages/Costs.tsx';
import { Bwa } from './pages/Bwa.tsx';
import { Settings } from './pages/Settings.tsx';
import type { AccountingReport } from '../calc/accounting-pdf.ts';
import { accountingMonths } from '../calc/accounting-history.ts';

const TABS = ['Übersicht', 'Mitarbeiter', 'Subs', 'Projekte', 'Jahr', 'Kosten', 'BWA/SuSa', 'Einstellungen'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('Übersicht');
  const [month, setMonth] = useState('');
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<AccountingReport[]>([]);
  const [booksVersion, setBooksVersion] = useState(0);
  const year = month.slice(0, 4);

  useEffect(() => {
    api<Me>('/api/me').then((m) => { setMe(m); setMonth(m.today.slice(0, 7)); }).catch((e) => setError(e.message));
  }, []);
  // accepted BWA/SuSa reports of the selected and the previous year; roles without access simply see none
  useEffect(() => {
    if (!year) return;
    api<AccountingReport[]>(`/api/accounting-reports?year=${year}`).then(setReports).catch(() => setReports([]));
  }, [year, booksVersion]);
  const history = useMemo(() => accountingMonths(reports), [reports]);
  const load = useCallback(() => {
    if (!month || tab === 'Übersicht' || tab === 'Subs' || tab === 'Mitarbeiter' || tab === 'Projekte') return;
    setError('');
    api<MonthData>(`/api/month?month=${month}`).then(setData).catch((e) => setError(e.message));
  }, [month, tab]);
  useEffect(load, [load]);

  const refresh = async () => {
    setBusy(true);
    try { await api('/api/refresh', { method: 'POST', json: { month } }); load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const canWrite = me?.role === 'gf' || me?.role === 'buchhaltung';
  const needsMonth = tab !== 'Jahr' && tab !== 'Einstellungen' && tab !== 'BWA/SuSa' && tab !== 'Übersicht' && tab !== 'Subs' && tab !== 'Mitarbeiter' && tab !== 'Projekte';

  return (
    <>
      <header className="bar">
        <a className="brand" href="/">
          <img src="/daso-logo.png" alt="DaSO" />
          <div><strong>DaSO Dashboard</strong><span>Umsatz, Personal und Kosten</span></div>
        </a>
        <nav>{TABS.map((t) => <button key={t} className={'tab' + (t === tab ? ' on' : '')} onClick={() => setTab(t)}>{t}</button>)}</nav>
        {me && <div className="who">{me.email}<br />{{ gf: 'Geschäftsführung', buchhaltung: 'Buchhaltung', viewer: 'Lesezugriff' }[me.role]}</div>}
      </header>
      <main>
        <h1>{tab}</h1>
        {month && tab !== 'Einstellungen' && tab !== 'Übersicht' && tab !== 'Subs' && tab !== 'Mitarbeiter' && tab !== 'Projekte' && (
          <div className="toolbar">
            {tab === 'Jahr' ? <>
              <button onClick={() => setMonth(shiftMonth(month, -12))} aria-label="Vorjahr">‹</button>
              <strong>{year}</strong>
              <button onClick={() => setMonth(shiftMonth(month, 12))} aria-label="Folgejahr">›</button>
            </> : <>
              <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Vormonat">‹</button>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" />
              <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Folgemonat">›</button>
              <span className="muted">{monthLabel(month)}</span>
            </>}
            <span className="spacer" />
            {canWrite && tab !== 'BWA/SuSa' && <button onClick={refresh} disabled={busy}>{busy ? 'Aktualisiere…' : 'Daten aktualisieren'}</button>}
          </div>
        )}
        {error && <div className="warn err">{error}</div>}
        {!data && !error && month && needsMonth && <div className="card">Lade {monthLabel(month)}…</div>}
        {tab === 'Übersicht' && month && <Overview selectedMonth={month} onPeriodChange={setMonth} accounting={history} />}
        {tab === 'Mitarbeiter' && month && <People initialMonth={month} />}
        {tab === 'Subs' && month && <Subs initialMonth={month} />}
        {tab === 'Projekte' && <Projects canEdit={canWrite} />}
        {tab === 'Jahr' && me && <Year year={Number((month || me.today).slice(0, 4))} accounting={history} reports={reports} />}
        {tab === 'Kosten' && me && <Costs me={me} month={month} onChange={load} reports={reports} onAccounting={() => setTab('BWA/SuSa')} />}
        {tab === 'BWA/SuSa' && me && <Bwa me={me} month={month} onChange={() => { load(); setBooksVersion((v) => v + 1); }} />}
        {tab === 'Einstellungen' && me && <Settings me={me} month={month} />}
      </main>
    </>
  );
}
