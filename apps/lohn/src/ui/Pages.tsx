import { useCallback, useEffect, useState } from 'react';
import { api, eur, fromCents, toCents, type MonthView } from './api.ts';
import type { Settings, Terms } from '../calc/month.ts';
import { MoneyInput } from './MoneyInput.tsx';

type TermsRow = Terms & { id: string };

export function EmployeesPage({ month }: { month: string }) {
  const [rows, setRows] = useState<TermsRow[]>([]);
  const [rates, setRates] = useState<Record<number, number>>({});
  const [from, setFrom] = useState(month + '-01');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<TermsRow[]>('/api/terms').then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); api<Settings>('/api/settings').then((s) => setRates(s.rates)).catch(() => {}); }, [load]);
  useEffect(() => setFrom(month + '-01'), [month]);
  const set = (id: string, patch: Partial<Terms>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = async (r: TermsRow) => {
    setMsg('');
    try {
      await api('/api/terms', 'PUT', { resourceId: r.id, validFrom: from, terms: { ...r, bonus: true, saturday: true, fixedSalaryCents: null, sub: !!r.sub, subRateCents: r.sub ? r.subRateCents ?? null : null } });
      setMsg(`Gespeichert für ${r.name}, gültig ab ${from.split('-').reverse().join('.')}.`);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section>
      <h1>Mitarbeiter und Konditionen</h1>
      <div className="toolbar">
        <label>Änderungen gelten ab <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <span className="muted">Freigegebene Monate bleiben unverändert.</span>
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
      <div className="scroll">
        <table className="grid">
          <thead><tr><th className="sticky">Name</th><th>Lohngruppe</th><th className="num">Stundensatz €/h</th><th>Zuschlag €/h</th><th>Obermonteur</th><th>Kostensatz €/h</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="sticky">{r.name}</th>
                <td><select aria-label={`Lohngruppe ${r.name}`} value={r.sub ? 'SUB' : r.lohngruppe ?? ''} onChange={(e) => { const v = e.target.value; set(r.id, v === 'SUB' ? { sub: true, lohngruppe: null } : { sub: false, lohngruppe: v ? Number(v) : null }); }}>
                  <option value="">-</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>LG {n}</option>)}<option value="SUB">SUB</option></select></td>
                <td className="num">{r.sub
                  ? <MoneyInput aria-label={`Stundensatz ${r.name}`} placeholder="z. B. 40,00" cents={r.subRateCents ?? null} onCommit={(c) => set(r.id, { subRateCents: c })} />
                  : r.lohngruppe ? <span aria-label={`Satz ${r.name}`}>{eur((rates[r.lohngruppe] ?? 0) + r.surchargeCents)}</span> : '-'}</td>
                <td><MoneyInput aria-label={`Zuschlag ${r.name}`} disabled={!!r.sub} cents={r.surchargeCents} onCommit={(c) => set(r.id, { surchargeCents: c ?? 0 })} /></td>
                <td><input type="checkbox" aria-label={`Obermonteur ${r.name}`} checked={r.foreman} onChange={(e) => set(r.id, { foreman: e.target.checked })} /></td>
                <td><MoneyInput aria-label={`Kostensatz ${r.name}`} disabled={!r.foreman} cents={r.foremanCostCents} onCommit={(c) => set(r.id, { foremanCostCents: c })} /></td>
                <td><button onClick={() => save(r)}>Speichern</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Loaded = Settings & { equalSplit: boolean };

export function SettingsPage() {
  const [s, setS] = useState<Loaded | null>(null);
  const [holidays, setHolidays] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api<Loaded>('/api/settings').then((x) => { setS(x); setHolidays(x.holidays.join('\n')); }).catch((e) => setMsg(e.message));
  }, []);
  if (!s) return <p className="muted">{msg || 'Lade ...'}</p>;
  const save = async () => {
    const list = holidays.split(/\s+/).filter(Boolean);
    if (list.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return setMsg('Feiertage im Format JJJJ-MM-TT, einer pro Zeile.');
    try { await api('/api/settings', 'PUT', { ...s, holidays: list }); setMsg('Gespeichert.'); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section>
      <h1>Einstellungen</h1>
      {msg && <p role="status">{msg}</p>}
      <div className="cols">
        <fieldset><legend>Lohngruppen (€/h)</legend>
          {Object.keys(s.rates).map((g) => (
            <label key={g}>LG {g}<MoneyInput aria-label={`Satz LG ${g}`} cents={s.rates[Number(g)]} onCommit={(c) => setS({ ...s, rates: { ...s.rates, [g]: c ?? 0 } })} /></label>
          ))}
        </fieldset>
        <fieldset><legend>Bonus und Zuschläge</legend>
          <label>Ersatzumsatz je Monat €<MoneyInput cents={s.absenceThreshold} onCommit={(c) => setS({ ...s, absenceThreshold: c ?? 0 })} /></label>
          <label>Samstagsanteil %<input inputMode="numeric" value={s.saturdayRate} onChange={(e) => setS({ ...s, saturdayRate: Number(e.target.value) || 0 })} /></label>
          <label>Nachtzuschlag 20 bis 6 Uhr %<input inputMode="numeric" value={s.nightPct} onChange={(e) => setS({ ...s, nightPct: Number(e.target.value) || 0 })} /></label>
          <label>Sonntag %<input inputMode="numeric" value={s.sundayPct} onChange={(e) => setS({ ...s, sundayPct: Number(e.target.value) || 0 })} /></label>
          <label>Feiertag %<input inputMode="numeric" value={s.holidayPct} onChange={(e) => setS({ ...s, holidayPct: Number(e.target.value) || 0 })} /></label>
          <label className="check"><input type="checkbox" checked={s.equalSplit} onChange={(e) => setS({ ...s, equalSplit: e.target.checked })} /> Aufmaße ohne persönliche Zuordnung vorläufig gleich verteilen</label>
        </fieldset>
        <fieldset><legend>Feiertage</legend>
          <textarea aria-label="Feiertage" rows={12} value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2027-01-01" />
        </fieldset>
      </div>
      <button className="primary" onClick={save}>Einstellungen speichern</button>
    </section>
  );
}

type Tool = { resource_id: string; price_cents: number; monthly_rate_cents: number; paid_before_cents: number; prepaid_cents: number };

export function ToolsPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [emps, setEmps] = useState<TermsRow[]>([]);
  const [view, setView] = useState<MonthView | null>(null);
  const [f, setF] = useState({ resourceId: '', price: '', rate: '', prepaid: '' });
  const [w, setW] = useState({ kw: '', hours: '', invoiced: '', rate: '40,00' });
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try {
      setTools(await api<Tool[]>('/api/tools')); setEmps(await api<TermsRow[]>('/api/terms')); setView(await api<MonthView>(`/api/months/${month}`));
    } catch (e) { setMsg((e as Error).message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const name = (id: string) => emps.find((e) => e.id === id)?.name || id;
  return (
    <section>
      <h1>Werkzeugkonto</h1>
      {msg && <p role="alert" className="error">{msg}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Mitarbeiter</th><th className="num">Preis</th><th className="num">Rate</th><th className="num">Bisher abgezogen</th><th className="num">Vorab bezahlt</th><th className="num">Restschuld</th></tr></thead>
        <tbody>{tools.map((t) => <tr key={t.resource_id}><td>{name(t.resource_id)}</td><td className="num">{eur(t.price_cents)}</td><td className="num">{eur(t.monthly_rate_cents)}</td><td className="num">{eur(t.paid_before_cents)}</td><td className="num">{eur(t.prepaid_cents)}</td><td className="num">{eur(Math.max(0, t.price_cents - t.paid_before_cents - t.prepaid_cents))}</td></tr>)}</tbody>
      </table></div>
      <form className="inline" aria-label="Werkzeugkonto anlegen" onSubmit={async (e) => {
        e.preventDefault();
        try { await api('/api/tools', 'PUT', { resourceId: f.resourceId, priceCents: toCents(f.price) ?? 0, monthlyRateCents: toCents(f.rate) ?? 0, prepaidCents: toCents(f.prepaid) ?? 0 }); setF({ resourceId: '', price: '', rate: '', prepaid: '' }); load(); } catch (x) { setMsg((x as Error).message); }
      }}>
        <select required aria-label="Mitarbeiter" value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })}><option value="">Mitarbeiter</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <input required placeholder="Preis €" aria-label="Preis" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <input required placeholder="Rate €/Monat" aria-label="Rate" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        <input placeholder="Vorab bezahlt €" aria-label="Vorab bezahlt" inputMode="decimal" value={f.prepaid} onChange={(e) => setF({ ...f, prepaid: e.target.value })} />
        <button className="primary">Speichern</button>
      </form>

      <h1>Externe Obermonteur-Wochen</h1>
      <div className="toolbar"><label>Monat <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label><span className="muted">Wochen zählen nach Leistungsdatum im Monat.</span></div>
      <div className="scroll"><table>
        <thead><tr><th>Woche</th><th className="num">Stunden</th><th className="num">Soll (Stunden × Satz)</th><th className="num">Rechnung netto</th><th className="num">Differenz</th><th /></tr></thead>
        <tbody>{view?.result.external.map((x) => (
          <tr key={x.id}><td>{x.label}</td><td className="num">{(x.minutes / 60).toFixed(1).replace('.', ',')}</td><td className="num">{eur(x.expected)}</td><td className="num">{eur(x.invoiced)}</td><td className={'num' + (x.diff ? ' neg' : '')}>{eur(x.diff)}</td>
            <td>{!view.frozen && <button onClick={async () => { await api(`/api/external/${x.id}`, 'DELETE'); load(); }}>Löschen</button>}</td></tr>
        ))}</tbody>
      </table></div>
      {view && !view.frozen && (
        <form className="inline" aria-label="Woche erfassen" onSubmit={async (e) => {
          e.preventDefault();
          try { await api('/api/external', 'POST', { month, kw: w.kw, minutes: Math.round(Number(w.hours.replace(',', '.')) * 60), invoicedCents: toCents(w.invoiced) ?? 0, rateCents: toCents(w.rate) ?? 4000 }); setW({ ...w, kw: '', hours: '', invoiced: '' }); setMsg(''); load(); } catch (x) { setMsg((x as Error).message); }
        }}>
          <input required placeholder="KW, z. B. 2027-W05" aria-label="KW" pattern="\d{4}-W\d{2}" value={w.kw} onChange={(e) => setW({ ...w, kw: e.target.value })} />
          <input required placeholder="Stunden" aria-label="Stunden" inputMode="decimal" value={w.hours} onChange={(e) => setW({ ...w, hours: e.target.value })} />
          <input required placeholder="Rechnung netto €" aria-label="Rechnung netto" inputMode="decimal" value={w.invoiced} onChange={(e) => setW({ ...w, invoiced: e.target.value })} />
          <input placeholder="Satz €/h" aria-label="Satz" inputMode="decimal" value={w.rate} onChange={(e) => setW({ ...w, rate: e.target.value })} />
          <button className="primary">Erfassen</button>
        </form>
      )}
    </section>
  );
}

export function AuditPage() {
  const [rows, setRows] = useState<{ at: string; actor: string; action: string; detail: string }[]>([]);
  useEffect(() => { api<typeof rows>('/api/audit').then(setRows).catch(() => {}); }, []);
  return (
    <section>
      <h1>Protokoll</h1>
      <div className="scroll"><table><thead><tr><th>Zeit</th><th>Person</th><th>Aktion</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{new Date(r.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td><td>{r.actor}</td><td>{r.action}</td><td>{r.detail}</td></tr>)}</tbody></table></div>
    </section>
  );
}

type Role = { email: string; role: string; name: string };
const ROLE_LABEL: Record<string, string> = { gf: 'Geschäftsführung', buchhaltung: 'Buchhaltung' };

export function AccessPage({ me }: { me: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [f, setF] = useState({ email: '', role: 'buchhaltung', name: '' });
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api<Role[]>('/api/roles').then(setRoles).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { setMsg(''); await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <section>
      <h1>Zugänge</h1>
      <p className="muted">Wer sich im Lohntool anmelden darf. Wer hier nicht steht, sieht keine Daten.</p>
      {msg && <p role="alert" className="error">{msg}</p>}
      <div className="scroll"><table>
        <thead><tr><th>E-Mail</th><th>Name</th><th>Rolle</th><th /></tr></thead>
        <tbody>
          <tr><td>{me}</td><td className="muted">Inhaber</td><td>Geschäftsführung</td><td /></tr>
          {roles.filter((r) => r.email !== me).map((r) => (
            <tr key={r.email}>
              <td>{r.email}</td><td>{r.name}</td>
              <td><select aria-label={`Rolle ${r.email}`} value={r.role} onChange={(e) => run(() => api('/api/roles', 'PUT', { ...r, role: e.target.value }))}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td><button onClick={() => run(() => api(`/api/roles/${encodeURIComponent(r.email)}`, 'DELETE'))}>Entfernen</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Zugang hinzufügen</h2>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/roles', 'PUT', f); setF({ ...f, email: '', name: '' }); }); }}>
        <input type="email" required placeholder="E-Mail" aria-label="E-Mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input placeholder="Name" aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select aria-label="Rolle" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="primary">Zugang setzen</button>
      </form>
    </section>
  );
}
