import { useCallback, useEffect, useState } from 'react';
import { api, eur, hours, type MonthView } from './api.ts';
import type { Settings, Terms } from '../calc/month.ts';
import { MoneyInput } from './MoneyInput.tsx';
import { ToolAccounts } from './ToolAccounts.tsx';

type TermsRow = Terms & { id: string; groupSince?: string | null; nextGroup?: { from: string; group: number | null; sub: boolean } | null };

const germanDate = (day: string) => day.split('-').reverse().join('.');

export function EmployeesPage({ month, setMonth }: { month: string; setMonth: (month: string) => void }) {
  const [rows, setRows] = useState<TermsRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Terms>>>({});
  const [report, setReport] = useState<MonthView | null>(null);
  const [from, setFrom] = useState(month + '-01');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [reportError, setReportError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const termsPath = '/api/terms?month=' + month;
  useEffect(() => {
    let active = true;
    setRows([]); setEdits({}); setReport(null); setMsg(''); setError(''); setReportError('');
    api<TermsRow[]>(termsPath).then(data => { if (active) setRows(data); })
      .catch(e => { if (active) setError(e.message); });
    api<MonthView>('/api/months/' + month).then(data => { if (active) setReport(data); })
      .catch(e => { if (active) setReportError(e.message); });
    return () => { active = false; };
  }, [month, refresh, termsPath]);
  useEffect(() => setFrom(month + '-01'), [month]);

  const set = (id: string, patch: Partial<Terms>) => setEdits(changes => ({ ...changes, [id]: { ...changes[id], ...patch } }));
  const save = async (r: TermsRow) => {
    if (!from || saving) return;
    const terms = edits[r.id];
    if (!terms) return;
    setSaving(true); setMsg(''); setError('');
    try {
      await api('/api/terms', 'PATCH', { resourceId: r.id, validFrom: from, terms });
      setEdits(changes => Object.fromEntries(Object.entries(changes).filter(([id]) => id !== r.id)));
      setMsg(`Gespeichert für ${r.name}, gültig ab ${germanDate(from)}.`);
      setRows(await api<TermsRow[]>(termsPath));
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  const overview = new Map(report?.result.rows.map(row => [row.resourceId, row.overview]));
  const number = (value: number | undefined) => value === undefined ? '–' : String(value);
  const minutes = (value: number | undefined) => value === undefined ? '–' : hours(value);
  return (
    <section>
      <h1>Mitarbeiter</h1>
      <div className="toolbar">
        <label>Monat <input type="month" value={month} disabled={saving} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <label>Änderungen gelten ab <input type="date" value={from} disabled={saving} onChange={e => setFrom(e.target.value)} /></label>
        <button disabled={saving} onClick={() => setRefresh(value => value + 1)}>Aktualisieren</button>
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {reportError && <p role="alert" className="error">{reportError}</p>}
      {!report && !reportError && <p role="status" className="muted">Aktuelle Stunden und Umsätze werden geladen …</p>}
      <div className="scroll"><table className="grid">
        <thead><tr><th className="sticky">Name</th><th>Lohngruppe</th><th>SUB-Satz €/h</th><th>Zuschlag €/h</th><th>Obermonteur</th><th>Kostensatz €/h</th>
          <th className="num">Anfahrt (h)</th><th className="num">Gearbeitet (h)</th><th className="num">Summe (h)</th><th className="num">Umsatz</th>
          <th className="num">Urlaub (Tage)</th><th className="num">Krank (Tage)</th><th className="num">Feiertage (Tage)</th><th /></tr></thead>
        <tbody>{rows.map(saved => {
          const draft = edits[saved.id];
          const r = { ...saved, ...draft };
          const o = overview.get(r.id);
          return <tr key={r.id}><th scope="row" className="sticky">{r.name}</th>
            <td><select aria-label={`Lohngruppe ${r.name}`} value={r.sub ? 'SUB' : r.lohngruppe ?? ''} disabled={saving} onChange={e => {
              const v = e.target.value;
              set(r.id, v === 'SUB' ? { sub: true, lohngruppe: null } : { sub: false, lohngruppe: v ? Number(v) : null, subRateCents: null });
            }}><option value="">–</option>{[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>LG {n}</option>)}<option value="SUB">SUB</option></select>
              {draft?.sub === undefined && saved.groupSince && (saved.sub || saved.lohngruppe) && <div className="muted">seit {germanDate(saved.groupSince)}</div>}
              {draft?.sub === undefined && saved.nextGroup && <div className="muted">{saved.nextGroup.sub ? 'SUB' : saved.nextGroup.group ? 'LG ' + saved.nextGroup.group : 'Ohne Lohngruppe'} ab {germanDate(saved.nextGroup.from)}</div>}
            </td>
            <td>{r.sub && <MoneyInput className="amt" aria-label={`SUB-Satz ${r.name}`} cents={r.subRateCents ?? null} disabled={saving}
              onCommit={c => c !== (r.subRateCents ?? null) && set(r.id, { subRateCents: c })} />}</td>
            <td><MoneyInput className="amt" aria-label={`Zuschlag ${r.name}`} disabled={saving || !!r.sub} cents={r.surchargeCents}
              onCommit={c => (c ?? 0) !== r.surchargeCents && set(r.id, { surchargeCents: c ?? 0 })} /></td>
            <td><input type="checkbox" aria-label={`Obermonteur ${r.name}`} disabled={saving} checked={r.foreman} onChange={e => set(r.id, { foreman: e.target.checked })} /></td>
            <td><MoneyInput className="amt" aria-label={`Kostensatz ${r.name}`} disabled={saving || !r.foreman} cents={r.foremanCostCents}
              onCommit={c => c !== r.foremanCostCents && set(r.id, { foremanCostCents: c })} /></td>
            <td className="num">{minutes(o?.travel)}</td><td className="num">{minutes(o?.worked)}</td><td className="num">{minutes(o ? o.travel + o.worked : undefined)}</td>
            <td className="num">{o ? eur(o.revenue) : '–'}</td><td className="num">{number(o?.vacation)}</td>
            <td className="num">{number(o?.sick)}</td><td className="num">{number(o?.holiday)}</td>
            <td><button disabled={saving || !from} onClick={() => void save(r)}>Speichern</button></td>
          </tr>;
        })}</tbody>
      </table></div>
      <ToolAccounts employees={rows.filter(row => !row.sub)} refresh={refresh} />
    </section>
  );
}

type Loaded = Settings & { equalSplit: boolean };
const PAY_GROUP_DESCRIPTIONS: Record<number, string> = {
  1: 'Arbeiten ohne einschlägige Ausbildung',
  2: 'Arbeiten nach Einarbeitung mit Kenntnissen in Teilbereichen',
  3: 'Fachbezogenes Handwerk mit abgeschlossener Handwerkslehre',
  4: 'Einfache fachbezogene Arbeiten nach Einarbeitung unter Aufsicht, mit abgeschlossener Handwerkslehre',
  5: 'Fachbezogene Arbeiten in Werkstatt und Montage unter Aufsicht',
  6: 'Selbstständige Montage, Reparaturen und bei Bedarf Aufmaß und Rechnungsunterlagen (Ecklohn)',
  7: 'Selbstständige Facharbeit mit zusätzlichen fachlichen und organisatorischen Anforderungen',
  8: '8a Gruppenführer (Obermonteur), 8b Kundendienstmonteur',
  9: 'Bauleitender Obermonteur für größere Baustellen und Teams',
};

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
        <fieldset className="wage-groups"><legend>Lohngruppen (€/h)</legend>
          {Object.keys(s.rates).map((g) => (
            <label key={g}><span><strong>LG {g}</strong> {PAY_GROUP_DESCRIPTIONS[Number(g)]}</span>
              <MoneyInput aria-label={`Satz LG ${g}`} cents={s.rates[Number(g)]} onCommit={c => setS({ ...s, rates: { ...s.rates, [g]: c ?? 0 } })} /></label>
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
