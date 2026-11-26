import { useCallback, useEffect, useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { api, money, monthLabel, toCents } from '../api.ts';
import { linesFromRows, pdfLines, type Line } from '../../calc/bwa.ts';
import { readAccountingPdf } from '../accounting-pdf-read.ts';
import { BwaTable } from './BwaTable.tsx';
import { FileDrop } from '../FileDrop.tsx';
import type { AccountingReport } from '../../calc/accounting-pdf.ts';
import type { Me } from '../types.ts';

type Imp = { id: string; kind: string; period: string; version: number; filename: string; source_format: string; mapping_version: number; imported_by: string; imported_at: string; status: string; unmapped: number; edited_at: string | null; report?: string | null };
type Detail = { import: Imp; lines: { n: number; account: string; label: string; cents: number; bucket: string }[]; buckets: string[] };

const csvRows = (t: string) => t.split(/\r?\n/).filter(Boolean).map((l) => l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '')));
const toB64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export function Bwa({ me, month, onChange }: { me: Me; month: string; onChange: () => void }) {
  const [period, setPeriod] = useState(month);
  const [kind, setKind] = useState<'bwa' | 'susa'>('bwa');
  const [list, setList] = useState<Imp[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [cmp, setCmp] = useState<any>(null);
  const [err, setErr] = useState('');
  const allowed = me.role === 'gf' || me.role === 'buchhaltung';
  const fail = (e: unknown) => setErr((e as Error).message);

  const load = useCallback(() => {
    api<Imp[]>(`/api/bwa?period=${period}`).then(setList).catch(fail);
    api(`/api/bwa-compare?period=${period}`).then(setCmp).catch(fail);
  }, [period]);
  useEffect(load, [load]);

  const send = async (lines: Line[], filename: string, format: string, file?: string, as = { kind, period }, report?: AccountingReport) => {
    if (!file || format !== 'pdf-ocr') setErr('');
    if (!lines.length) return setErr('Keine Zeilen erkannt. Bitte Datei prüfen.');
    try { const r = await api<{ id: string }>('/api/bwa/import', { method: 'POST', json: { ...as, filename, format, lines, file, report } }); await open(r.id); load(); } catch (e) { fail(e); }
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith('.xlsx')) await send(linesFromRows(await readXlsxFile(f) as unknown[][]), f.name, 'xlsx', toB64(await f.arrayBuffer()));
      else if (name.endsWith('.csv')) await send(linesFromRows(csvRows(await f.text())), f.name, 'csv', toB64(await f.arrayBuffer()));
      else if (name.endsWith('.pdf')) {
        const r = await readAccountingPdf(f);
        setKind(r.kind); setPeriod(r.period);
        if (r.ocr) setErr('Dieses PDF ist ein Scan und wurde per Texterkennung gelesen. Bitte alle Beträge in der Prüfmaske kontrollieren.');
        await send(pdfLines(r), f.name, r.ocr ? 'pdf-ocr' : 'pdf', toB64(await f.arrayBuffer()), { kind: r.kind, period: r.period }, r);
      }
      else setErr('Bitte .xlsx, .csv oder .pdf wählen.');
    } catch (x) { fail(x); }
  };
  const open = (id: string) => { setDraft(null); return api<Detail>(`/api/bwa/${id}`).then(setDetail).catch(fail); };
  const map = async (n: number, bucket: string) => { try { await api(`/api/bwa/${detail!.import.id}/map`, { method: 'POST', json: { n, bucket } }); await open(detail!.import.id); load(); } catch (e) { fail(e); } };
  const remove = async (i: Imp) => {
    if (!window.confirm(`${i.kind.toUpperCase()} v${i.version} (${i.filename}) endgültig löschen? Die Datei und alle Zeilen werden entfernt.`)) return;
    try { await api(`/api/bwa/${i.id}`, { method: 'DELETE' }); if (detail?.import.id === i.id) setDetail(null); load(); onChange(); } catch (e) { fail(e); }
  };
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const saveDraft = async () => {
    if (!draft || !detail) return;
    const edits = Object.entries(draft).map(([n, v]) => ({ n: Number(n), cents: toCents(v.replace(/−/g, '-')) }));
    const bad = edits.find((e) => Number.isNaN(e.cents));
    if (bad) return setErr(`Zeile ${detail.lines.find((l) => l.n === bad.n)?.label}: Bitte einen Betrag wie -1.234,56 eingeben.`);
    try { await api(`/api/bwa/${detail.import.id}/lines`, { method: 'POST', json: { edits } }); setDraft(null); await open(detail.import.id); load(); onChange(); } catch (e) { fail(e); }
  };
  const accept = async () => { try { await api(`/api/bwa/${detail!.import.id}/accept`, { method: 'POST' }); await open(detail!.import.id); load(); onChange(); } catch (e) { fail(e); } };
  const takeSuggestion = async (name: string, monthly: number) => {
    const d = new Date(Date.parse(period + '-01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() + 1);
    try { await api('/api/suggestion/accept', { method: 'POST', json: { name, monthly, validFrom: d.toISOString().slice(0, 10) } }); load(); onChange(); } catch (e) { fail(e); }
  };

  return (
    <>
      {err && <div className="warn err">{err}</div>}
      <section className="card">
        <h2>BWA / SuSa importieren</h2>
        <div className="row">
          <label>Periode<input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></label>
          <label>Typ<select value={kind} onChange={(e) => setKind(e.target.value as 'bwa' | 'susa')}><option value="bwa">BWA</option><option value="susa">SuSa</option></select></label>
        </div>
        {allowed && <FileDrop accept=".xlsx,.csv,.pdf" title="BWA oder SuSa hochladen" hint="PDF, XLSX oder CSV" onFiles={([f]) => onFile(f)} onReject={() => setErr('Bitte .xlsx, .csv oder .pdf wählen.')} />}
        <small className="muted">BWA und SuSa derselben Periode werden nie addiert; ein erneuter Import erzeugt eine neue Version. Jeder Import wird erst nach der Prüfung der Kontenzuordnung übernommen. Das Standard-Mapping ist ein Startpunkt und muss mit echten Dateien des Steuerberaters geprüft werden.</small>
        <div className="scroll"><table><thead><tr><th>Typ</th><th>Version</th><th>Datei</th><th>Importiert</th><th>Status</th><th>Offen</th><th></th></tr></thead><tbody>
          {list.map((i) => <tr key={i.id}><td>{i.kind.toUpperCase()}</td><td>{i.version}</td><td>{i.filename}</td><td>{new Date(i.imported_at).toLocaleString('de-DE')} · {i.imported_by}</td><td>{i.status}</td><td className={i.unmapped ? 'err' : ''}>{i.unmapped}</td><td><button className="btn" onClick={() => open(i.id)}>Prüfen</button>{allowed && <> <button className="btn" onClick={() => remove(i)}>Löschen</button></>}</td></tr>)}
        </tbody></table></div>
      </section>

      {detail && (
        <section className="card">
          <div className="row"><h2>Prüfmaske {detail.import.kind.toUpperCase()} v{detail.import.version}, {monthLabel(detail.import.period)}</h2><span className="spacer" />
            {detail.import.edited_at && <small className="muted">Manuell korrigiert</small>}
            {allowed && !draft && !detail.import.report && <button className="btn" onClick={() => setDraft({})}>Beträge korrigieren</button>}
            {allowed && draft && <><button className="btn primary" onClick={saveDraft}>Korrekturen speichern</button><button className="btn" onClick={() => setDraft(null)}>Abbrechen</button></>}
            {allowed && detail.import.status === 'review' && <button className="btn primary" onClick={accept} disabled={detail.import.unmapped > 0 || !!draft}>Übernehmen</button>}</div>
          {detail.import.kind === 'bwa' && !(detail.lines.some((l) => l.bucket === 'umsatz') && detail.lines.some((l) => l.bucket === 'betriebsergebnis')) &&
            <div className="warn">In dieser BWA fehlen Umsatz oder Betriebsergebnis. Das Format wurde vermutlich nicht vollständig erkannt: bitte mit der Originaldatei vergleichen.</div>}
          <div className="scroll"><table><thead><tr><th>Konto</th><th>Bezeichnung</th><th>Betrag</th><th>Zuordnung</th></tr></thead><tbody>
            {detail.lines.map((l) => <tr key={l.n} style={!l.bucket ? { background: 'color-mix(in srgb, var(--amber) 22%, transparent)' } : undefined}>
              <td>{l.account}</td><td>{l.label}</td><td>{draft ? <input style={{ width: 120, textAlign: 'right' }} aria-label={l.label} defaultValue={(l.cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, useGrouping: false })} onChange={(e) => setDraft({ ...draft, [l.n]: e.target.value })} /> : money(l.cents)}</td>
              <td>{allowed && detail.import.status === 'review' ? <select value={l.bucket} onChange={(e) => map(l.n, e.target.value)}><option value="">– wählen –</option>{detail.buckets.map((b) => <option key={b}>{b}</option>)}</select> : l.bucket}</td></tr>)}
          </tbody></table></div>
          {detail.import.kind === 'bwa' && detail.import.report && <BwaTable report={JSON.parse(detail.import.report)} edited={!!detail.import.edited_at} disabled={!allowed}
            onSave={async (report) => { await api(`/api/bwa/${detail.import.id}/report`, { method: 'PUT', json: { report } }); await open(detail.import.id); load(); onChange(); }} />}
        </section>
      )}

      <section className="card">
        <h2>Abgleich {monthLabel(period)}</h2>
        {cmp?.source ? <>
          <div className="tiles">
            <div className="tile"><small>BWA/SuSa-Umsatz ({cmp.source.kind.toUpperCase()} v{cmp.source.version})</small><strong>{money(cmp.bwa.revenue)}</strong></div>
            <div className="tile"><small>Operativer Umsatz (Leistungsdatum)</small><strong>{money(cmp.operational)}</strong></div>
            <div className="tile"><small>Differenz</small><strong>{money(cmp.difference)}</strong></div>
            <div className="tile"><small>Betriebsergebnis</small><strong>{money(cmp.bwa.operating)}</strong><small>Marge {cmp.bwa.margin ?? '–'} %</small></div>
            <div className="tile"><small>Steuerreserve (Planung, {cmp.taxReservePct} %)</small><strong>{money(cmp.taxReserve)}</strong><small>kein Steuerbescheid</small></div>
          </div>
          <p className="muted">{cmp.note}</p>
          <h2>Vorschlag Folgemonat</h2>
          <table><thead><tr><th>Kostenart</th><th>Standard</th><th>Ist letzte Periode</th><th>Abweichung</th><th></th></tr></thead><tbody>
            {cmp.suggestion.map((s: any) => <tr key={s.name}><td>{s.name}</td><td>{money(s.current)}</td><td>{money(s.proposed)}</td><td>{money(s.deviation)}</td><td>{me.role === 'gf' && <button className="btn" onClick={() => takeSuggestion(s.name, s.proposed)}>Übernehmen ab Folgemonat</button>}</td></tr>)}
          </tbody></table>
          <small className="muted">Die Übernahme ist der Geschäftsführung vorbehalten und legt eine neue Version an; bestehende Werte werden nicht überschrieben.</small>
        </> : <p className="muted">{cmp?.note || 'Lade…'}</p>}
      </section>
    </>
  );
}
