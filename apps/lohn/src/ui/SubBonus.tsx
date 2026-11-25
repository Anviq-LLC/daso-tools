import { useEffect, useRef, useState } from 'react';
import type { SubBonusView } from '../calc/sub-bonus.ts';
import { api, eur, hours } from './api.ts';
import { MoneyInput } from './MoneyInput.tsx';

const monthName = (month: string) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(month + '-01T12:00:00Z'));
const money = (cents: number | null) => cents === null ? 'offen' : eur(cents);

export function SubBonus({ month, resourceId, frozen }: { month: string; resourceId: string; frozen: boolean }) {
  const [data, setData] = useState<SubBonusView | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef(false);
  const path = `/api/sub-bonus/${month}/${encodeURIComponent(resourceId)}`;

  useEffect(() => {
    let active = true;
    api<SubBonusView>(path).then(value => { if (active) setData(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [path]);

  const save = async (item: string, cents: number | null, current: number | null) => {
    if (cents === null || cents === current || frozen || pendingSave.current) return;
    if (cents < 0) { setError('Bitte einen Betrag ab 0,00 € eingeben.'); return; }
    pendingSave.current = true;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await api(path, 'PUT', { item, cents });
      setData(await api<SubBonusView>(path));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  };

  if (!data) return <section className="sub-bonus">
    <h3>SUB-Monatsbonus</h3>
    {error ? <p role="alert" className="error">{error}</p> : <p className="muted">Vormonat wird geladen …</p>}
  </section>;

  const disabled = frozen || saving;
  const bonus = data.storedBonus ?? data.proposedBonus;
  return <section className="sub-bonus" aria-label="SUB-Monatsbonus">
    <h3>Bonus für {monthName(data.period)}</h3>
    <div className="scroll"><table>
      <thead><tr><th scope="col">Stundenrechnungen</th><th scope="col" className="num">Nach Stunden</th><th scope="col" className="num">Rechnungsbetrag</th></tr></thead>
      <tbody>{data.weeks.map(week => {
        const item = `week:${week.kw}`;
        const label = `KW ${week.kw.slice(-2)}`;
        return <tr key={week.kw}>
          <th scope="row">{label}<div className="muted">{hours(week.workMinutes + week.travelMinutes)} h</div></th><td className="num">{eur(week.suggestedCents)}</td>
          <td className="num"><MoneyInput className="amt" aria-label={`Rechnungsbetrag ${label}`} disabled={disabled}
            cents={week.invoiceCents ?? week.suggestedCents} onCommit={value => void save(item, value, week.invoiceCents ?? week.suggestedCents)} /></td>
        </tr>;
      })}
        <tr><th scope="row" colSpan={2}>Bonus {monthName(data.previousPeriod)}</th>
          <td className="num"><MoneyInput className="amt" aria-label={`Bonus ${monthName(data.previousPeriod)}`} disabled={disabled}
            cents={data.previousBonusCents} onCommit={value => void save('prior-bonus', value, data.previousBonusCents)} /></td></tr>
      </tbody>
      <tfoot><tr><th scope="row" colSpan={2}>Kosten gesamt</th><td className="num">{eur(data.costs)}</td></tr></tfoot>
    </table></div>
    <div className="scroll sub-bonus-result"><table aria-label="Bonusberechnung">
      <tbody>
        <tr><th scope="row">Eigener Aufmaßumsatz</th><td className="num">{eur(data.ownRevenue)}</td></tr>
        {data.projects.map(project => <tr key={project.projectId}>
          <th scope="row">{project.projectName}</th><td className="num">{money(project.profit)}</td>
        </tr>)}
        <tr><th scope="row">Projektgewinn gesamt</th><td className="num">{money(data.projectProfit)}</td></tr>
        <tr><th scope="row">Kosten gesamt</th><td className="num">{eur(-data.costs)}</td></tr>
        <tr className="strong"><th scope="row">Gewinn</th><td className={'num' + ((data.profit ?? 0) < 0 ? ' neg' : '')}>{money(data.profit)}</td></tr>
        <tr className="strong"><th scope="row">Bonusvorschlag (10 %)</th><td className="num">{money(data.proposedBonus)}</td></tr>
      </tbody>
    </table></div>
    {data.previousBonusCents === null && <p className="muted">Gewinn und Vorschlag sind vorläufig. Bitte den Bonus aus {monthName(data.previousPeriod)} ergänzen.</p>}
    {data.projectProfit === null && <p className="muted">Für mindestens ein Projekt fehlen Aufmaßwerte.</p>}
    <div className="inline">
      <label>Bonusbetrag <MoneyInput className="amt" cents={bonus} disabled={disabled}
        onCommit={value => void save('bonus', value, bonus)} /></label>
      {data.storedBonus === null && <button type="button" disabled={disabled || data.previousBonusCents === null || data.proposedBonus === null}
        onClick={() => void save('bonus', data.proposedBonus, data.storedBonus)}>Bonus übernehmen</button>}
    </div>
    {data.storedBonus !== null && !saved && <p className="muted">Bonusbetrag gespeichert.</p>}
    {saved && <p role="status" className="muted">Betrag gespeichert.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
