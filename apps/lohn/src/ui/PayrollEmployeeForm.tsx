import { useEffect, useState, type FormEvent } from 'react';
import { api, fromCents, toCents } from './api.ts';

type Employee = {
  id: string; name: string; role: string; sub?: boolean;
  manual: boolean; removedFromMonth: string | null;
  fixedSalaryCents: number | null; hourlyRateCents?: number | null; monthlyHoursHundredths?: number | null;
};
type PayBasis = 'fixed' | 'hourly';
const displayMonth = (period: string) => new Intl.DateTimeFormat('de-DE', {
  year: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(period + '-01T00:00:00Z'));

export function PayrollEmployeeForm({ month, onSaved, onCancel }: {
  month: string; onSaved: (period: string) => void; onCancel: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [fromMonth, setFromMonth] = useState(month);
  const [resourceId, setResourceId] = useState('');
  const [selectedBasis, setSelectedBasis] = useState<PayBasis | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  useEffect(() => {
    let active = true;
    setEmployees(null);
    if (!fromMonth) return;
    api<Employee[]>(`/api/terms?month=${fromMonth}&includeRemoved=true`).then(list => {
      if (!active) return;
      const available = list.filter(person => !person.sub);
      setEmployees(available);
      setResourceId(id => available.some(person => person.id === id) ? id : '');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [fromMonth]);

  const person = employees?.find(item => item.id === resourceId);
  const removed = !!person?.removedFromMonth && person.removedFromMonth <= fromMonth;
  const isRemoved = (item: Employee) => item.removedFromMonth !== null && item.removedFromMonth <= fromMonth;
  const basis = selectedBasis ?? (person?.hourlyRateCents != null ? 'hourly' : 'fixed');
  const hourly = basis === 'hourly';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !employees || removed || confirmRemoval) return;
    const fields = new FormData(event.currentTarget);
    const payCents = toCents(String(fields.get('pay') ?? ''));
    const hoursInput = String(fields.get('hours') ?? '').trim();
    const monthHours = hoursInput ? toCents(hoursInput) : null;
    setError('');
    if (payCents === null || payCents <= 0 || !Number.isSafeInteger(payCents)) {
      setError(hourly ? 'Bitte einen gültigen Brutto-Stundensatz eingeben.' : 'Bitte ein gültiges monatliches Brutto-Festgehalt eingeben.');
      return;
    }
    if (hourly && hoursInput && (monthHours === null || monthHours < 0 || !Number.isSafeInteger(monthHours))) {
      setError('Bitte gültige Monatsstunden ab 0 eingeben.');
      return;
    }
    setSaving(true);
    try {
      const data = resourceId ? { resourceId } : { name: fields.get('name'), role: fields.get('role') };
      const pay = hourly ? { hourlyRateCents: payCents, monthlyHoursHundredths: monthHours } : { salaryCents: payCents };
      await api('/api/payroll/employees', 'POST', { ...data, ...pay, fromMonth, payBasis: basis });
      onSaved(fromMonth);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changeAvailability(action: 'remove' | 'restore') {
    if (saving || !person?.manual) return;
    setSaving(true);
    setError('');
    try {
      await api('/api/payroll/employees', 'PATCH', { resourceId, fromMonth, action });
      onSaved(fromMonth);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <section>
    {error && <p role="alert" className="error">{error}</p>}
    <form className="inline payroll-employee-form" aria-label="Mitarbeiter und Vergütung" onSubmit={save}>
      <label>Person
        <select value={resourceId} disabled={saving || !employees} onChange={e => {
          setResourceId(e.target.value); setSelectedBasis(null); setConfirmRemoval(false); setError('');
        }}>
          <option value="">Neue Person anlegen</option>
          {employees?.map(item => <option key={item.id} value={item.id}>{item.name}{item.role ? ' · ' + item.role : ''}
            {isRemoved(item) ? ' · entfernt' : ''}</option>)}
        </select>
      </label>
      {!resourceId && <>
        <label>Vollständiger Name<input name="name" required maxLength={100} disabled={saving} /></label>
        <label>Funktion<select name="role" disabled={saving}><option>Büro</option><option>Geschäftsführung</option></select></label>
      </>}
      {!removed && !confirmRemoval && <>
        <label>Vergütung <select name="payBasis" value={basis} disabled={saving} onChange={e => setSelectedBasis(e.target.value as PayBasis)}>
          <option value="fixed">Festgehalt</option><option value="hourly">Stundenlohn</option>
        </select></label>
        <label>{hourly ? 'Brutto-Stundensatz (€)' : 'Brutto-Festgehalt pro Monat (€)'}
          <input name="pay" inputMode="decimal" required className="amt" key={JSON.stringify([resourceId, basis, person?.fixedSalaryCents, person?.hourlyRateCents])}
            defaultValue={fromCents(hourly ? person?.hourlyRateCents : person?.fixedSalaryCents)} disabled={saving} />
        </label>
        {hourly && <label>Stunden im Abrechnungsmonat
          <input name="hours" inputMode="decimal" className="amt" key={JSON.stringify([resourceId, fromMonth, person?.monthlyHoursHundredths])}
            defaultValue={fromCents(person?.monthlyHoursHundredths)} placeholder="Einsatzplanung" disabled={saving} />
        </label>}
      </>}
      <label>Gültig ab Monat<input name="fromMonth" type="month" required value={fromMonth} disabled={saving}
        onChange={e => { setError(''); setConfirmRemoval(false); setFromMonth(e.target.value); }} /></label>
      {removed && person?.removedFromMonth ? <>
        <span className="muted">Entfernt ab {displayMonth(person.removedFromMonth)}</span>
        <button type="button" disabled={saving} onClick={() => void changeAvailability('restore')}>Entfernung rückgängig machen</button>
      </> : confirmRemoval && person ? <>
        <span>{person.name} ab {displayMonth(fromMonth)} aus der Abrechnung entfernen? Frühere Monate bleiben erhalten.</span>
        <button type="button" className="error" disabled={saving} onClick={() => void changeAvailability('remove')}>Entfernen bestätigen</button>
      </> : <>
        <button className="primary" disabled={saving || !employees}>Speichern</button>
        {person?.manual && <button type="button" className="error" disabled={saving} onClick={() => {
          setError(''); setConfirmRemoval(true);
        }}>Mitarbeiter entfernen</button>}
      </>}
      <button type="button" onClick={() => {
        if (confirmRemoval) { setConfirmRemoval(false); setError(''); }
        else onCancel();
      }} disabled={saving}>Abbrechen</button>
    </form>
  </section>;
}
