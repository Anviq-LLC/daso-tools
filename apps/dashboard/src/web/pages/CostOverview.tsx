import { accountingCosts, costColumns } from '../../calc/accounting-costs.ts';
import { money, monthLabel } from '../api.ts';
import type { AccountingReport } from '../../calc/accounting-pdf.ts';

const negative=(value:number|null)=>(value??0)<0?'err':undefined;

export function CostOverview({year,reports,onAccounting}:{
  year:string;
  reports:AccountingReport[];
  onAccounting:()=>void;
}){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format();
  const {months,actual,forecast,basis}=accountingCosts(reports,year,today.slice(0,7));
  const incompleteSubs=months.some(row=>row.kind==='actual'&&row.costs.subs===null);
  return <>
    <div className="tiles">
      <div className="tile"><small>Gebuchte Kosten {year} · erfasste Monate</small><strong>{money(actual.total)}</strong></div>
      <div className="tile"><small>Prognose · offene Monate {year}</small><strong>{money(forecast.total)}</strong></div>
      <div className="tile"><small>Gesamt {year} · Ist und Prognose</small><strong>{money(actual.total===null&&forecast.total===null?null:(actual.total??0)+(forecast.total??0))}</strong></div>
    </div>
    <section className="card cost-overview">
      <div className="row"><h2>Monatliche Kosten {year}</h2><span className="spacer"/><button className="btn" onClick={onAccounting}>BWA/SuSa öffnen</button></div>
      {actual.total===null&&<p>Für {year} sind noch keine auswertbaren Kostenberichte gespeichert.</p>}
      <div className="scroll">
        <table>
          <thead><tr><th scope="col">Monat</th><th scope="col">Quelle</th>
            {costColumns.map(([key,label])=><th scope="col" key={key}>{label}</th>)}<th scope="col">Gesamt</th>
          </tr></thead>
          <tbody>{months.map(({period,costs,total,kind,source})=><tr key={period} className={kind==='forecast'?'cost-projection':undefined}>
            <th scope="row">{monthLabel(period)}</th><td>{source}</td>
            {costColumns.map(([key])=><td key={key} className={negative(costs[key])}>{money(costs[key])}</td>)}
            <td className={negative(total)}><strong>{money(total)}</strong></td>
          </tr>)}</tbody>
          <tfoot>{([['Erfasste Monate',actual],['Prognose',forecast]] as const).filter(([,figures])=>figures.total!==null).map(([label,figures])=>
            <tr key={label}><th scope="row" colSpan={2}>{label}</th>
              {costColumns.map(([key])=><td key={key} className={negative(figures.costs[key])}>{money(figures.costs[key])}</td>)}
              <td className={negative(figures.total)}>{money(figures.total)}</td>
            </tr>
          )}</tfoot>
        </table>
      </div>
      <p className="muted">Die BWA liefert die gebuchten Gesamtkosten inklusive Wareneinsatz. Die SuSa ergänzt die Aufteilung der Aufwandskonten. Ertragsteuern und neutrale Aufwendungen sind separat in der BWA ausgewiesen.</p>
      {incompleteSubs&&<p className="muted">Bei BWA-Monaten ohne Aufschlüsselung des Wareneinsatzes bleibt die Spalte Nachunternehmer offen. Der betreffende Betrag steckt in den sonstigen Kosten.</p>}
      {forecast.total!==null&&<p className="muted">Prognose auf Basis von {basis.map(monthLabel).join(', ')}. Für Nachunternehmer berücksichtigt die Prognose die Winterpause ab KW 52.</p>}
    </section>
  </>;
}
