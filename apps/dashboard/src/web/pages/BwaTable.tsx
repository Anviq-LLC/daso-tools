import { useState, type FormEvent } from 'react';
import { bwaColumns, bwaDraft, correctedBwa, type BwaDraftRow } from '../../calc/accounting-edit.ts';
import type { AccountingReport } from '../../calc/accounting-pdf.ts';
import { money } from '../api.ts';

type Bwa = Extract<AccountingReport, { kind: 'bwa' }>;

// Full BWA table with correctable amounts; saving sends the whole corrected report to the server.
export function BwaTable({ report, edited, disabled, onSave }: { report: Bwa; edited: boolean; disabled: boolean; onSave: (report: Bwa) => Promise<void> }) {
  const [draft, setDraft] = useState<BwaDraftRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || disabled || saving) return;
    setError('');
    let corrected: Bwa;
    try { corrected = correctedBwa(report, draft); } catch (e) { return setError(e instanceof Error ? e.message : 'Bitte die Eingaben prüfen.'); }
    setSaving(true);
    try { await onSave(corrected); setDraft(null); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return <form onSubmit={save}>
    <div className="row">
      <h2>BWA-Zeilen</h2><span className="spacer" />
      {edited && <small className="muted">Manuell korrigiert</small>}
      {!draft && <button type="button" className="btn" disabled={disabled} onClick={() => setDraft(bwaDraft(report.rows))}>Beträge korrigieren</button>}
    </div>
    {draft && <p className="muted">Beträge in Euro. Korrigiere bei Bedarf auch die zugehörigen Summenzeilen.</p>}
    {error && <p role="alert" className="err">{error}</p>}
    <div className="scroll">
      <table><thead><tr><th scope="col">Position</th>{bwaColumns.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}</tr></thead><tbody>
        {report.rows.map((row, index) => <tr key={index}><th scope="row">{row.label}</th>
          {bwaColumns.map(({ key, label }) => <td key={key} className={(row[key] ?? 0) < 0 ? 'err' : undefined}>
            {draft ? <input className="bwa-amount" type="text" inputMode="decimal" aria-label={row.label + ' · ' + label} value={draft[index][key]} disabled={saving}
              onChange={(event) => { const value = event.target.value; setDraft((cur) => cur?.map((item, i) => (i === index ? { ...item, [key]: value } : item)) ?? null); }} /> : money(row[key])}
          </td>)}
        </tr>)}
      </tbody></table>
    </div>
    {draft && <div className="row"><button type="submit" className="btn primary" disabled={disabled || saving}>Korrekturen speichern</button>
      <button type="button" className="btn" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Abbrechen</button></div>}
  </form>;
}
