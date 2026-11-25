import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.ts';
import { MonthPage } from './MonthPage.tsx';
import { PayrollPage } from './Payroll.tsx';
import { AccessPage, EmployeesPage, SettingsPage, AuditPage } from './Pages.tsx';
import logo from './logo.png';
import './style.css';

const TABS = [['month', 'Monat'], ['payroll', 'Lohnabrechnung'], ['employees', 'Mitarbeiter'], ['settings', 'Einstellungen'], ['audit', 'Protokoll'], ['access', 'Zugänge']] as const;
type Tab = (typeof TABS)[number][0];
type Session = { email: string; role: string };

function App() {
  const [me, setMe] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('month');
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format().slice(0, 7));
  useEffect(() => {
    api<Session>('/api/me').then(setMe).catch((e) => setError(e.message));
  }, []);
  if (error) return <main className="center"><h1>Kein Zugang</h1><p role="alert">{error}</p></main>;
  if (!me) return <main className="center"><p>Lade ...</p></main>;
  return (
    <>
      <header className="bar">
        <a className="brand" href="/" aria-label="DaSO Lohntool Startseite"><img src={logo} alt="DaSo Lüftungsbau" /><div><strong>DaSo Lüftungsbau</strong><span>Lohnvorbereitung</span></div></a>
        <nav aria-label="Bereiche">
          {TABS.filter(([k]) => k !== 'access' || me.role === 'gf').map(([k, label]) => (
            <button key={k} className={tab === k ? 'tab on' : 'tab'} aria-current={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <span className="who">{me.email} · {me.role === 'gf' ? 'Geschäftsführung' : 'Buchhaltung'}</span>
      </header>
      <main>
        {tab === 'month' && <MonthPage month={month} setMonth={setMonth} role={me.role} />}
        {tab === 'payroll' && <PayrollPage month={month} setMonth={setMonth} role={me.role} />}
        {tab === 'employees' && <EmployeesPage month={month} setMonth={setMonth} />}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'access' && me.role === 'gf' && <AccessPage me={me.email} />}
        {tab === 'audit' && <AuditPage />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
