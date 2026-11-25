import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, dayLabel, download, money, monthLabel } from '../api.ts';
import { projectWeek, shiftProjectDay } from '../../calc/project-dashboard.ts';
import { subCalendarFirms, subCalendarMetrics, subCalendarWeeks, type SubCalendarDay } from '../../calc/sub-calendar.ts';
import { PeriodCalendar } from '../PeriodCalendar.tsx';

const dates=new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
const headings=['Umsatz','Kosten','Gewinn','Personentage','Ø Tagessatz','Ø Kosten','Ø Gewinn','Tage','Projekte'];

function weekLabel(monday:string){
  const thursday=new Date(shiftProjectDay(monday,3)+'T12:00:00Z');
  const year=thursday.getUTCFullYear();
  const number=Math.ceil(((thursday.getTime()-Date.UTC(year,0,1,12))/86400000+1)/7);
  return 'KW '+number+' · '+dates.formatRange(new Date(monday+'T12:00:00Z'),new Date(projectWeek(monday).to+'T12:00:00Z'));
}

function MetricHeaders({first}:{first:string}){
  return <thead><tr><th scope="col">{first}</th>{headings.map(heading=><th scope="col" key={heading}>{heading}</th>)}</tr></thead>;
}

function MetricCells({metrics}:{metrics:ReturnType<typeof subCalendarMetrics>}){
  const {revenue,cost,profit,personDays,averageRevenue,averageCost,averageProfit,days,projects}=metrics;
  return <>
    <td>{money(revenue)}</td><td title={cost===null?'In mindestens einem Aufmaß fehlen Kosten.':undefined}>{money(cost)}</td>
    <td className={(profit??0)<0?'err':(profit??0)>0?'ok':undefined}>{money(profit)}</td>
    <td>{personDays||'–'}</td><td>{money(averageRevenue)}</td><td>{money(averageCost)}</td>
    <td className={(averageProfit??0)<0?'err':(averageProfit??0)>0?'ok':undefined}>{money(averageProfit)}</td><td>{days}</td><td>{projects}</td>
  </>;
}

function WeekDetails({rows,firm}:{rows:SubCalendarDay[];firm:string}){
  const weeks=subCalendarWeeks(rows);
  return <div className="sub-week-panel" aria-label={'Kalenderwochen für '+firm}>
    {weeks.map(week=><section key={week.week} className="sub-week">
      <h3>{weekLabel(week.week)}</h3>
      <div className="sub-table-scroll"><table>
        <MetricHeaders first="Projekt"/>
        <tbody>
          <tr className="sub-week-total"><th scope="row">Woche gesamt</th><MetricCells metrics={week}/></tr>
          {week.byProject.map(project=><tr key={project.id}><th scope="row">{project.name}</th><MetricCells metrics={project}/></tr>)}
        </tbody>
      </table></div>
      <details>
        <summary>Tageswerte je Projekt und Team</summary>
        <div className="sub-table-scroll"><table>
          <thead><tr><th scope="col">Tag</th><th scope="col">Projekt</th><th scope="col">Team</th><th scope="col">Abrechnung</th>
            <th scope="col">Umsatz</th><th scope="col">Kosten</th><th scope="col">Personen</th><th scope="col">Umsatz je Person</th></tr></thead>
          <tbody>{week.byProject.flatMap(project=>project.rows).map(row=>
            <tr key={JSON.stringify([row.day,row.projectId,row.team,row.basis])}>
              <th scope="row">{dayLabel(row.day)} {row.estimated&&<span className="chip est" title="Aufmaß über mehrere Tage verteilt">verteilt</span>}</th>
              <td>{row.project}</td><td>{row.team}</td><td>{row.basis==='hourly'?'Stunden':'Leistung'}</td>
              <td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{row.heads??'–'}</td>
              <td>{money(row.heads?Math.round(row.revenue/row.heads):null)}</td>
            </tr>)}</tbody>
        </table></div>
      </details>
    </section>)}
  </div>;
}

export function Subs({initialMonth}:{initialMonth:string}){
  const [year,setYear]=useState(initialMonth.slice(0,4));
  const [month,setMonth]=useState(initialMonth.slice(5));
  const [reload,setReload]=useState(0);
  const [firm,setFirm]=useState<string|null>(null);
  const [loaded,setLoaded]=useState<{year:string;rows:SubCalendarDay[]}|null>(null);
  const [error,setError]=useState('');
  const rows=loaded?.year===year?loaded.rows:null;
  const period=month?year+'-'+month:null;

  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    api<SubCalendarDay[]>('/api/sub-calendar?year='+year,{signal:controller.signal})
      .then(rows=>{if(!controller.signal.aborted)setLoaded({year,rows});})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[year,reload]);

  const firms=useMemo(()=>subCalendarFirms((rows??[]).filter(row=>!period||row.day.startsWith(period))),[rows,period]);
  function chooseMonth(value:string){setMonth(value);setFirm(null);}
  function chooseYear(year:string){setYear(year);setFirm(null);}

  return <>
    <PeriodCalendar title="Nachunternehmer-Kalender" year={year} month={month}
      onYear={chooseYear} onMonth={chooseMonth} onReload={()=>setReload(value=>value+1)}/>

    <section className="card sub-overview">
      <div className="row sub-calendar-header">
        <h2>Nachunternehmer · {period?monthLabel(period):year+' gesamt'}</h2><span className="spacer"/>
        {firms.length>0&&<button type="button" className="btn" onClick={()=>
          download('/api/export?what=sub-calendar&year='+year+(period?'&month='+period:''))}>CSV</button>}
      </div>
      {error&&<p className="err" role="alert">{error}</p>}
      {rows===null&&!error&&<p role="status">Nachunternehmerdaten werden geladen …</p>}
      {rows!==null&&firms.length===0&&<p>Für diesen Zeitraum liegen keine verbindlichen Aufmaße vor.</p>}
      {firms.length>0&&<>
        <div className="sub-table-scroll"><table>
          <MetricHeaders first="Nachunternehmer"/>
          <tbody>{firms.map(row=><Fragment key={row.firm}>
            <tr>
              <th scope="row"><button type="button" className="sub-firm-toggle" aria-expanded={firm===row.firm}
                onClick={()=>setFirm(firm===row.firm?null:row.firm)}>
                <span aria-hidden="true">{firm===row.firm?'▾':'▸'}</span> {row.firm}
              </button></th>
              <MetricCells metrics={row}/>
            </tr>
            {firm===row.firm&&<tr><td className="sub-expanded-firm" colSpan={headings.length+1}><WeekDetails rows={row.rows} firm={row.firm}/></td></tr>}
          </Fragment>)}</tbody>
        </table></div>
        <p className="muted">Ø Tagessatz, Ø Kosten und Ø Gewinn beziehen sich jeweils auf einen Personentag. Kalenderwochen zeigen die Buchungen im gewählten Zeitraum.</p>
      </>}
    </section>
  </>;
}
