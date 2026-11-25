import { useEffect, useState } from 'react';
import { api, money, monthLabel } from '../api.ts';
import { YearRevenueChart } from '../YearRevenueChart.tsx';
import type { YearData } from '../types.ts';
import { yearRevenue, type AccountingMonth } from '../../calc/accounting-history.ts';
import { dashboardYear } from '../../calc/dashboard-year.ts';
import { accountingCosts, otherYearCosts } from '../../calc/accounting-costs.ts';
import type { AccountingReport } from '../../calc/accounting-pdf.ts';

const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('de-DE',{timeZone:'UTC'});
const percent=new Intl.NumberFormat('de-DE',{style:'percent',maximumFractionDigits:1});
const operatingMargin=(result:number|null,bwaRevenue:number|null)=>
  result!==null&&bwaRevenue!==null&&bwaRevenue!==0?result/bwaRevenue:null;

function OperatingResult({value,margin,description}:{
  value:number|null; margin:number|null; description:string;
}){
  return <>{money(value)}{margin!==null&&<small className="muted year-figure-detail" title={description}>Marge {percent.format(margin)}</small>}</>;
}

function ProjectRankingTable({projects,loss=false}:{projects:YearData['projectsTop'];loss?:boolean}){
  return <div className="scroll"><table>
    <thead><tr><th scope="col">Rang</th><th scope="col">Projekt</th><th scope="col">{loss?'Verlust':'Gewinn'}</th></tr></thead>
    <tbody>{projects.map((project,index)=><tr key={project.id}>
      <td>{index+1}</td><td>{project.label}</td><td className={loss?'err':undefined}>{money(project.before)}</td>
    </tr>)}</tbody>
  </table></div>;
}

const monthColumns = [
  ['revenue','Umsatz'], ['staff','Mitarbeiterkosten'], ['subs','Nachunternehmerkosten'],
  ['vehicles','Kfz-Kosten'], ['equipment','Werkzeugkosten'], ['office','Bürokosten'],
  ['other','Sonstige Kosten'], ['total','Gesamtkosten'],
  ['operating','BWA-Betriebsergebnis'], ['beforeTax','BWA vor Steuern'],
] as const;

export function Year({ year, accounting, reports }: { year: number; accounting:Map<string,AccountingMonth>; reports:AccountingReport[] }) {
  const [y, setY] = useState<YearData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setY(null); api<YearData>(`/api/year?year=${year}`).then(setY).catch((e) => setErr(e.message)); }, [year]);
  const observed = new Map(y?.months.map(row => [row.month,row]));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format();
  const currentMonth=today.slice(0,7);
  const {months:costMonths}=accountingCosts(reports,String(year),currentMonth);
  const months = Array.from({length:12},(_,index)=>{
    const month=year+'-'+String(index+1).padStart(2,'0');
    const live=observed.get(month), book=accounting.get(month);
    const liveRevenue=live&&month<=currentMonth&&(live.hasRevenueData??live.hasData)?live.revenue:null;
    const figures=yearRevenue(book,liveRevenue);
    const lastDay=month+'-'+new Date(Date.UTC(year,index+1,0)).getUTCDate();
    const revenueThrough=figures.useBwa?(lastDay>today?today:lastDay):live?.revenueThrough??null;
    return {month,book,revenueThrough,...figures};
  });
  const hasAccounting=months.some(row=>row.book)||costMonths.some(row=>row.total!==null);
  const running=months.find(row=>row.month===currentMonth);
  const runningForecast=running?.revenue!=null?y?.forecast.points.find(point=>point.month===currentMonth&&point.kind==='prognose')?.revenue??null:null;
  const summary=dashboardYear(months,today,runningForecast);
  if(err&&!hasAccounting)return <div className="warn err">{err}</div>;
  if(!y&&!err&&!hasAccounting)return <div className="card">Lade {year}…</div>;
  const tableMonths=months.map(({month,book,revenue,source},index)=>{
    const costMonth=costMonths[index];
    const {costs,equipment,total}=costMonth;
    return {month,source,costMonth,bwaRevenue:book?.revenue??null,figures:{
      revenue,staff:costs.staff,subs:costs.subs,vehicles:costs.vehicles,equipment,office:costs.office,
      other:otherYearCosts(costMonth),total,operating:book?.operating??null,beforeTax:book?.beforeTax??null,
    }};
  });
  const columnTotals=monthColumns.map(([key])=>{
    const values=tableMonths.map(row=>row.figures[key]).filter(value=>value!==null);
    const count=values.length;
    const total=values.reduce((sum,value)=>sum+value,0);
    return {count,total:count?total:null,average:count?Math.sign(total)*Math.round(Math.abs(total)/count)||0:null};
  });
  let bwaRevenueTotal=0, operatingTotal=0, marginTotal=0, marginCount=0;
  for(const {bwaRevenue,figures:{operating}} of tableMonths){
    if(bwaRevenue===null||operating===null)continue;
    bwaRevenueTotal+=bwaRevenue;
    operatingTotal+=operating;
    const margin=operatingMargin(operating,bwaRevenue);
    if(margin===null)continue;
    marginTotal+=margin;
    marginCount++;
  }
  const annualMargin=operatingMargin(operatingTotal,bwaRevenueTotal);
  const averageMargin=marginCount?marginTotal/marginCount:null;
  return (
    <>
      {err&&<div className="warn">Aufmaßdaten konnten nicht geladen werden. Die importierten Buchhaltungswerte sind sichtbar.</div>}
      <div className="tiles">
        <div className="tile year-kpi"><small>Ist-Umsatz {year} · erfasste Monate</small><strong>{money(summary.total)}</strong>
          <small>{summary.revenueThrough?'Erfasst bis '+dateLabel(summary.revenueThrough):'Datenstand · offen'}</small>
          {running&&<div><small>Prognose Umsatz {year}</small><strong>{money(summary.yearForecast)}</strong></div>}
        </div>
        {running&&<div className="tile year-kpi"><small>Umsatz {monthLabel(currentMonth)} · erfasst</small><strong>{money(running.revenue)}</strong>
          <small>{running.useBwa?running.source:running.revenueThrough?'Erfasst bis '+dateLabel(running.revenueThrough):'Datenstand · offen'}</small>
          <div><small>{running.useBwa?'Monatswert laut BWA':'Prognose Monatsumsatz'}</small><strong>{money(summary.currentForecast)}</strong></div>
        </div>}
        <div className="tile year-kpi"><small>Jahresgewinn vor Steuern · BWA</small><strong>{money(summary.profit)}</strong>
          <small>{summary.profitThrough?(summary.cumulative?'BWA bis ':'Verfügbare BWA-Monate bis ')+monthLabel(summary.profitThrough):'BWA-Ergebnis fehlt'}</small>
          <div><small>Voraussichtliche Steuern · 30 %</small><strong>{money(summary.estimatedTax)}</strong></div>
        </div>
        <div className="tile"><small>Umsatz nach Bereich {year}</small><strong>{money(y?y.months.reduce((a,m)=>a+m.own,0):null)}</strong>
          <small>Eigene Mitarbeiter</small>
          <div><small>Nachunternehmer</small><strong>{money(y?y.months.reduce((a,m)=>a+m.sub,0):null)}</strong></div></div>
        {y&&y.totals.profit!==null&&<div className="tile"><small>Gewinn Ist (Schätzung) · Aufmaß und Kosten</small><strong>{money(y.totals.profit)}</strong><small>keine BWA</small></div>}
        {running&&<div className="tile"><small>Gewinn/Verlust {monthLabel(currentMonth)} · {running.book?.beforeTax!=null?'BWA':'Prognose'}</small>
          <strong>{money(summary.currentProfit)}</strong>
          {running.book?.beforeTax==null&&<small>{summary.margin===null?'BWA-Marge fehlt':'BWA-Marge '+summary.margin.toLocaleString('de-DE',{style:'percent',maximumFractionDigits:1})+' × prognostizierter Monatsumsatz'}</small>}
        </div>}
      </div>
      <section className="card">
        <h2>Monatsumsatz</h2>
        <YearRevenueChart points={summary.points} />
        <div className="scroll"><table className="year-months">
          <thead><tr><th scope="col">Monat</th><th scope="col">Umsatzquelle</th>{monthColumns.map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead>
          <tbody>{tableMonths.map(({month,source,costMonth,bwaRevenue,figures})=><tr key={month}>
            <td>{monthLabel(month)}</td><td>{source==='Offen'&&month===currentMonth?'Laufend · offen':source}</td>
            {monthColumns.map(([key])=>key==='total'
              ? <td key={key} title={costMonth.source}><strong>{money(figures.total)}</strong>{costMonth.kind==='forecast'&&<small className="muted year-figure-detail">Prognose</small>}</td>
              : <td key={key}>{key==='operating'
                ? <OperatingResult value={figures.operating} margin={operatingMargin(figures.operating,bwaRevenue)} description="BWA-Betriebsergebnis geteilt durch BWA-Umsatz"/>
                : money(figures[key])}</td>)}
          </tr>)}</tbody>
          <tfoot>
            <tr><th scope="row" colSpan={2}>Jahressumme {year}</th>
              {columnTotals.map(({total},index)=>{
                const [key]=monthColumns[index];
                return <td key={key}>{key==='operating'
                  ? <OperatingResult value={total} margin={annualMargin} description="BWA-Betriebsergebnis geteilt durch BWA-Umsatz für Monate mit beiden Werten"/>
                  : money(total)}</td>;
              })}
            </tr>
            <tr><th scope="row" colSpan={2}>Monatsdurchschnitt</th>
              {columnTotals.map(({average,count},index)=>{
                const [key]=monthColumns[index];
                return <td key={key} title={count===1?'1 Monat':count+' Monate'}>{key==='operating'
                  ? <OperatingResult value={average} margin={averageMargin} description="Durchschnitt der berechenbaren Monatsmargen"/>
                  : money(average)}</td>;
              })}
            </tr>
          </tfoot>
        </table></div>
        <p className="muted">Die Kosten stammen aus BWA und SuSa. Ausgewiesene Werkzeugkosten sind aus den sonstigen Kosten herausgerechnet.</p>
        <p className="muted">Summe und Durchschnitt basieren je Spalte auf den angezeigten Monatswerten, inklusive ausgewiesener Kostenprognosen. Nur Monate mit einem Wert gehen in den Durchschnitt ein.</p>
      </section>
      {y&&<section className="card">
        <h2>Mitarbeiter-Ranking (realer Umsatz, 90 %)</h2>
        <div className="scroll"><table>
          <thead><tr><th scope="col">Mitarbeiter</th><th scope="col">Umsatz {monthLabel(y.employeeRankingMonth)}</th><th scope="col">Umsatz {year} gesamt</th><th scope="col">Jahresrang</th><th scope="col">Ausgleich</th><th scope="col">Bewertung</th></tr></thead>
          <tbody>{y.employees.map((employee,index)=><tr key={employee.id}>
            <td>{employee.name}</td><td>{money(employee.monthlyReal)}</td><td>{money(employee.real)}</td><td>{index+1}</td><td>{money(employee.fiction)}</td><td>{money(employee.valuation)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      {y&&<div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
        <section className="card"><h2>Sub-Ranking</h2><div className="scroll"><table><thead><tr><th>#</th><th>Nachunternehmer</th><th>Umsatz</th><th>Gewinn</th></tr></thead><tbody>
          {y.subs.map((s, i) => <tr key={s.firm}><td>{i + 1}</td><td>{s.firm}</td><td>{money(s.revenue)}</td><td>{money(s.profit)}</td></tr>)}</tbody></table></div></section>
        <section className="card">
          <h2>Projekte Top · nach Gewinn</h2>
          {y.projectsTop.length>0?<ProjectRankingTable projects={y.projectsTop}/>:<p className="muted">Keine Projekte mit positivem Ergebnis.</p>}
          {y.projectsFlop.length>0&&<>
            <h2 style={{ marginTop: 12 }}>Projekte Flop</h2>
            <ProjectRankingTable projects={y.projectsFlop} loss/>
          </>}
          <small className="muted">Ergebnis aus den verfügbaren direkten Kosten vor Gemeinkosten.</small>
        </section>
      </div>}
    </>
  );
}
