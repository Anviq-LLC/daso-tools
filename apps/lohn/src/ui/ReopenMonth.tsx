import { useState, type FormEvent } from 'react';
import { api } from './api.ts';

export function ReopenMonth({ month, onReopened }: { month: string; onReopened: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function reopen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason?.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/months/${month}/status`, 'POST', { to: 'pruefung', reason: reason.trim() });
      setReason(null);
      onReopened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (reason === null) return <button type="button" onClick={() => setReason('')}>Erneut bearbeiten</button>;
  return <form className="inline" aria-label="Abrechnung erneut bearbeiten" onSubmit={reopen}>
    <label>Grund für die Korrektur <input required autoFocus maxLength={300} value={reason}
      onChange={e => setReason(e.target.value)} disabled={saving} /></label>
    <button className="primary" disabled={saving || !reason.trim()}>Zur Bearbeitung öffnen</button>
    <button type="button" disabled={saving} onClick={() => { setReason(null); setError(''); }}>Abbrechen</button>
    {error && <span className="error" role="alert">{error}</span>}
  </form>;
}
