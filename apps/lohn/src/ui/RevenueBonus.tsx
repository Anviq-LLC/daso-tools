import { useEffect, useState } from 'react';
import type { Row } from '../calc/month.ts';
import { progressiveBonusTiers } from '../calc/bonus.ts';
import { FORECAST_HOURS_PER_DAY, summarizeEmployeePay } from '../calc/payroll.ts';
import { api, eur, fromCents, toCents } from './api.ts';

type CalculatedTier = ReturnType<typeof progressiveBonusTiers>[number];
const tierCalculation = (tier: CalculatedTier) => <>
  <span className="muted">{eur(tier.eligible)} × {tier.rate} % = </span><strong>{eur(tier.cents)}</strong>
</>;


export function RevenueBonus({ month, row, frozen, onDone }: {
  month: string; row: Row; frozen: boolean; onDone: () => Promise<void>;
}) {
  const detail = row.revenueBonus;
  const forecast = frozen ? null : detail?.forecast;
  const tiers = detail?.tiers ?? [];
  const forecastTiers = forecast ? progressiveBonusTiers(forecast.projectedBasis, tiers) : [];
  const pay = row.paySummary ?? summarizeEmployeePay(row);
  const grossForecast = frozen ? null : pay.forecast;
  const displayedPay = grossForecast ?? pay.actual;
  const { correction } = pay.actual;
  const override = detail?.override;
  const { saturdayRevenue } = row.metrics;
  const saturday = row.lines.find(line => line.code === 'SAM');
  const other = displayedPay.other - (saturday?.cents ?? 0);
  const [amount, setAmount] = useState(correction ? fromCents(correction) : '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setAmount(correction ? fromCents(correction) : ''), [correction]);

  async function save(value: string) {
    if (saving || frozen) return;
    const trimmed = value.trim();
    const cents = trimmed ? toCents(trimmed) : 0;
    setMessage(''); setError('');
    if (cents === null || !Number.isSafeInteger(cents)) {
      setError('Bitte einen gültigen Betrag eingeben.'); return;
    }
    if (cents === correction && (override === undefined || trimmed)) {
      setAmount(correction ? fromCents(correction) : ''); return;
    }
    setSaving(true);
    try {
      await api('/api/bonus-correction', 'PUT', { month, resourceId: row.resourceId, cents });
      await onDone();
      setMessage('Umsatzbonus-Korrektur gespeichert.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="revenue-bonus" aria-label="Berechnung Umsatzbonus">
    <h3>Bruttolohn</h3>
    <div className={forecast ? 'bonus-columns' : undefined}>
      <div className="scroll"><table aria-label="Bruttolohn im gewählten Monat">
        <tbody>
          <tr><th scope="row">Grundgehalt{grossForecast?.wageDays ? ' (Prognose)' : ''}
            {!!grossForecast?.wageDays && <div className="muted bonus-calculation-note">
              {grossForecast.wageDays} {grossForecast.wageDays === 1 ? 'offener Arbeitstag' : 'offene Arbeitstage'} × {FORECAST_HOURS_PER_DAY} Std.
            </div>}
          </th><td className="num">{eur(displayedPay.base)}</td></tr>
          <tr><th scope="row">Umsatzbonus{grossForecast?.bonusProjected ? ' (Prognose Bonus)' : ''}</th>
            <td className="num">{eur(displayedPay.bonus)}</td></tr>
          {saturday && <tr><th scope="row">Samstagsbonus
            <div className="muted bonus-calculation-note">{saturday.note}</div>
          </th><td className="num">{eur(saturday.cents)}</td></tr>}
          <tr><th scope="row">Korrektur Umsatzbonus Vormonat</th><td className="num">
            {frozen ? eur(correction) : <>
              <span className="employee-print-hide"><input aria-label="Korrektur Umsatzbonus Vormonat" className="amt" inputMode="decimal" disabled={saving}
                placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)}
                onBlur={e => void save(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /> €</span>
              <span className="employee-print-only">{eur(correction)}</span>
            </>}
          </td></tr>
          {other !== 0 && <tr><th scope="row">Weitere Bruttobeträge</th><td className="num">{eur(other)}</td></tr>}
        </tbody>
        <tfoot><tr><th scope="row">Bruttolohn gesamt{grossForecast ? ' (Prognose)' : ''}</th>
          <td className="num">{eur(displayedPay.gross)}</td></tr></tfoot>
      </table></div>
      {forecast && <div className="scroll"><table aria-label="Umsatzprognose">
        <thead><tr><th colSpan={2}>Umsatzprognose</th></tr></thead>
        <tbody>
          <tr><th scope="row">Ø erfasster Tagesumsatz</th><td className="num">{forecast.averageRevenue === null ? '–' : eur(forecast.averageRevenue)}</td></tr>
          <tr><th scope="row">Tage mit Umsatz / offene Arbeitstage</th><td className="num">{forecast.pastDays} / {forecast.remainingDays}</td></tr>
        </tbody>
      </table></div>}
    </div>
    {detail?.enabled === false && override === undefined && <p className="muted">Für diese Person ist kein Umsatzbonus hinterlegt.</p>}
    {!detail && <p className="muted">Für diesen gespeicherten Monatsstand ist nur die Berechnungssumme hinterlegt.</p>}
    {!saturday && !!saturdayRevenue && <p className="muted">Samstagsumsatz {eur(saturdayRevenue)}</p>}
    {!!tiers.length && <div className="scroll bonus-tiers"><table aria-label="Bonusstaffel und Rechenweg">
      <thead><tr>
        <th scope="col">Umsatzstufe</th>
        <th scope="col" className="num">{forecast ? 'Bonus bisher' : 'Bonus je Umsatzstufe'}</th>
        {forecast && <th scope="col" className="num">Prognose Bonus</th>}
      </tr></thead>
      <tbody>{tiers.map((tier, index) => <tr key={`${tier.from}:${index}`}>
        <th scope="row">{tier.to === null ? `Ab ${eur(tier.from)}` : `${eur(tier.from)} bis ${eur(tier.to)}`}</th>
        <td className="num">{tierCalculation(tier)}</td>
        {forecast && <td className="num">{tierCalculation(forecastTiers[index])}</td>}
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row">Summe laut Bonusstaffel</th>
        <td className="num">{eur(tiers.reduce((sum, tier) => sum + tier.cents, 0))}</td>
        {forecast && <td className="num">{eur(forecast.projectedBonus)}</td>}
      </tr></tfoot>
    </table></div>}
    {message && <p role="status" className="muted">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
