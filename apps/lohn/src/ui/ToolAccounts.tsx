import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { toolInstallment } from '../calc/bonus.ts';
import { api, eur, fromCents, toCents } from './api.ts';

type Employee = { id: string; name: string };
type Account = { resource_id: string; price_cents: number; monthly_rate_cents: number; paid_before_cents: number; prepaid_cents: number; own_tools: number };

export function ToolAccounts({ employees, refresh }: { employees: Employee[]; refresh: number }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [ownToolsError, setOwnToolsError] = useState('');

  useEffect(() => {
    let active = true;
    setAccounts(null);
    setLoadError('');
    api<Account[]>('/api/tools').then(data => { if (active) setAccounts(data); })
      .catch(error => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [refresh, revision]);

  const byId = new Map(accounts?.map(account => [account.resource_id, account]));
  const money = (cents: number | undefined) => cents === undefined ? '–' : eur(cents);

  async function setOwnTools(employee: Employee, ownTools: boolean) {
    if (saving) return;
    setSaving(true);
    setOwnToolsError('');
    setMessage('');
    try {
      await api('/api/tools', 'PATCH', { resourceId: employee.id, ownTools });
      setAccounts(rows => {
        const current = rows ?? [];
        const account = current.find(row => row.resource_id === employee.id);
        const own_tools = Number(ownTools);
        return account
          ? current.map(row => row === account ? { ...row, own_tools } : row)
          : [...current, { resource_id: employee.id, own_tools, price_cents: 0, monthly_rate_cents: 0, paid_before_cents: 0, prepaid_cents: 0 }];
      });
    } catch (error) {
      setOwnToolsError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    setSaveError('');
    const fields = new FormData(event.currentTarget);
    const price = toCents(String(fields.get('price') ?? ''));
    const rate = toCents(String(fields.get('rate') ?? ''));
    const prepaid = toCents(String(fields.get('prepaid') ?? '').trim() || '0');
    if ([price, rate, prepaid].some(amount => amount === null || !Number.isSafeInteger(amount) || amount < 0)) {
      setSaveError('Bitte gültige Beträge ab 0,00 € eingeben.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/tools', 'PUT', { resourceId: editing.id, priceCents: price, monthlyRateCents: rate, prepaidCents: prepaid });
      setMessage(`Werkzeugkonto für ${editing.name} gespeichert.`);
      setEditing(null);
      setRevision(value => value + 1);
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tool-accounts" aria-labelledby="tool-accounts-title">
      <h2 id="tool-accounts-title">Werkzeugkonten</h2>
      {message && <p role="status" className="muted">{message}</p>}
      {ownToolsError && <p role="alert" className="error">{ownToolsError}</p>}
      {loadError && <p role="alert" className="error">Werkzeugkonten konnten nicht geladen werden. {loadError}</p>}
      {!accounts && !loadError && <p className="muted">Werkzeugkonten werden geladen …</p>}
      {accounts && employees.length > 0 && <div className="scroll">
        <table aria-labelledby="tool-accounts-title">
          <thead><tr>
            <th className="sticky" scope="col">Mitarbeiter</th>
            <th scope="col">Eigenes Werkzeug</th>
            <th className="num" scope="col">Preis</th>
            <th className="num" scope="col">Monatsrate</th>
            <th className="num" scope="col">Bisher abgezogen</th>
            <th className="num" scope="col">Vorab bezahlt</th>
            <th className="num" scope="col">Restschuld</th>
            <th scope="col">Aktion</th>
          </tr></thead>
          <tbody>{employees.map(employee => {
            const account = byId.get(employee.id);
            const tool = account && (account.price_cents || account.monthly_rate_cents || account.prepaid_cents || account.paid_before_cents) ? account : undefined;
            const debt = tool && toolInstallment(tool.price_cents, tool.paid_before_cents, tool.prepaid_cents, tool.monthly_rate_cents).debt;
            const action = tool ? 'Bearbeiten' : 'Anlegen';
            return <Fragment key={employee.id}><tr>
              <th className="sticky" scope="row">{employee.name}</th>
              <td><input type="checkbox" aria-label={`Eigenes Werkzeug mitgebracht ${employee.name}`} checked={!!account?.own_tools}
                disabled={saving} onChange={event => void setOwnTools(employee, event.currentTarget.checked)} /></td>
              <td className="num">{money(tool?.price_cents)}</td>
              <td className="num">{money(tool?.monthly_rate_cents)}</td>
              <td className="num">{money(tool?.paid_before_cents)}</td>
              <td className="num">{money(tool?.prepaid_cents)}</td>
              <td className="num strong">{money(debt)}</td>
              <td><button aria-label={`Werkzeugkonto ${employee.name} ${action.toLowerCase()}`} disabled={saving}
                onClick={() => { setEditing(employee); setMessage(''); setSaveError(''); }}>{action}</button></td>
            </tr>
            {editing?.id === employee.id && <tr><td colSpan={8}>
              <form className="inline" aria-label={`Werkzeugkonto ${employee.name}`} onSubmit={save}>
                <label>Preis € <input name="price" className="amt" required autoFocus inputMode="decimal" defaultValue={fromCents(tool?.price_cents)} /></label>
                <label>Monatsrate € <input name="rate" className="amt" required inputMode="decimal" defaultValue={fromCents(tool?.monthly_rate_cents)} /></label>
                <label>Vorab bezahlt € <input name="prepaid" className="amt" inputMode="decimal" defaultValue={fromCents(tool?.prepaid_cents)} /></label>
                <button className="primary" disabled={saving}>Werkzeugkonto speichern</button>
                <button type="button" disabled={saving} onClick={() => { setEditing(null); setSaveError(''); }}>Abbrechen</button>
              </form>
              {saveError && <p role="alert" className="error">{saveError}</p>}
            </td></tr>}</Fragment>;
          })}</tbody>
        </table>
      </div>}
    </section>
  );
}
