import { useEffect,useMemo,useState } from 'react';
import { api,dayLabel,download,hours,money,monthLabel } from '../api.ts';
import { PeriodCalendar } from '../PeriodCalendar.tsx';
import { daysOf } from '../../calc/report.ts';
import { employeeAbsences, employeeMetrics, employeePeriod, type EmployeeCalendarRow } from '../../calc/employee-calendar.ts';
import type { MonthData } from '../types.ts';

type Absences=ReturnType<typeof employeeMetrics>['absences'];
const absenceCodes=Object.entries(employeeAbsences) as [keyof Absences,string][];
const months=Array.from({length:12},(_,index)=>String(index+1).padStart(2,'0'));
const shortMonth=new Intl.DateTimeFormat('de-DE',{month:'short',timeZone:'UTC'});
const absenceLabels={vacation:'Urlaub',unpaid:'Unbezahlter Urlaub',sick:'Krank'};
type TodayAbsences={date:string;absences:{id:string;name:string;absence:keyof typeof absenceLabels}[]};

function absenceText(absences:Absences){
  return absenceCodes.flatMap(([key,code])=>absences[key]?[absences[key]+' '+code]:[]).join(' · ');
}

function EmployeeCalendar({people,period,year}:{people:EmployeeCalendarRow[];period:string|null;year:string}){
  const columns=period?daysOf(period):months.map(value=>year+'-'+value);
  return <section className="card">
    <h2>{period?'Tagesübersicht':'Monatsübersicht'}</h2>
    <div className="scroll"><table className="cal">
      <thead><tr><th scope="col">Mitarbeiter</th>{columns.map(key=><th scope="col" key={key}>
        {period?key.slice(8):shortMonth.format(new Date(key+'-15T12:00:00Z'))}
      </th>)}</tr></thead>
      <tbody>{people.map(person=>{
        const days=new Map(person.days.map(day=>[day.day,day]));
        return <tr key={person.id}><td>{person.code||person.name}</td>{columns.map(key=>{
          if(!period){
            const matching=person.days.filter(day=>day.day.startsWith(key+'-'));
            if(!matching.length)return <td key={key}>–</td>;
            const value=employeeMetrics(matching);
            return <td key={key}>{money(value.revenue)}
              {value.minutes!==null&&<small className="muted year-figure-detail">{hours(value.minutes)} h</small>}
              {absenceText(value.absences)&&<small className="muted year-figure-detail">{absenceText(value.absences)}</small>}
            </td>;
          }
          const day=days.get(key);
          const weekday=new Date(key+'T12:00:00Z').getUTCDay();
          return <td key={key} className={day?.absence?'abs':weekday===0||weekday===6?'sat':undefined}>
            {day?.hasRevenue&&<span title={money(day.revenue)}>{Math.round(day.revenue/100)} €</span>}
            {day?.minutes!=null&&<small className="muted year-figure-detail">{hours(day.minutes)} h</small>}
            {day?.absence&&<small className="year-figure-detail">{employeeAbsences[day.absence]}</small>}
          </td>;
        })}</tr>;
      })}</tbody>
    </table></div>
  </section>;
}

function EmployeeAbsencesToday({reload}:{reload:number}){
  const [today,setToday]=useState<TodayAbsences|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    setToday(null);
    api<TodayAbsences>('/api/employee-absences-today',{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setToday(result);})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[reload]);

  return <section className="card">
    <h2>Abwesenheiten heute{today?' · '+dayLabel(today.date):''}</h2>
    {error&&<p className="err" role="alert">Heutige Abwesenheiten konnten nicht geladen werden. {error}</p>}
    {!today&&!error&&<p role="status">Abwesenheiten werden geladen …</p>}
    {today&&(today.absences.length?<ul className="employee-absences-today">{today.absences.map(({id,name,absence})=>
      <li key={id}><strong>{name}</strong> <span className="chip">{absenceLabels[absence]}</span></li>
    )}</ul>:<p className="muted">Heute sind keine Abwesenheiten eingetragen.</p>)}
  </section>;
}

// Ausgleich, Bewertung and review flags exist per month only
function MonthEvaluation({month}:{month:string}){
  const [d,setD]=useState<{month:string;data:MonthData}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    api<MonthData>('/api/month?month='+month,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setD({month,data});}).catch(()=>{});
    return ()=>controller.abort();
  },[month]);
  if(d?.month!==month)return null;
  return <section className="card">
    <div className="row"><h2>Bewertung · {monthLabel(month)}</h2><span className="spacer"/><button className="btn" onClick={()=>download('/api/export?what=employees&month='+month)}>CSV</button></div>
    <div className="scroll"><table>
      <thead><tr><th>Mitarbeiter</th><th>Realer Umsatz 90 %</th><th>Fiktiver Ausgleich</th><th>Bewertungsumsatz</th><th>Samstag-Kennzahl 40 %</th><th>Prüfen</th></tr></thead>
      <tbody>{d.data.employees.map(e=><tr key={e.id}>
        <td>{e.name} {e.code&&<span className="chip">{e.code}</span>}</td><td>{money(e.real)}</td><td>{money(e.fiction)}</td><td>{money(e.valuation)}</td><td>{money(e.saturdayIndicator)}</td>
        <td className={e.reviewDays.length?'err':''}>{e.reviewDays.length?e.reviewDays.length+' Tag(e)':''}</td></tr>)}</tbody>
    </table></div>
    <small className="muted">Fiktiver Ausgleich ist nur eine interne Bewertung (kein Umsatz, kein Erlös) und fließt nicht in das Ranking. Samstag-Kennzahl = Samstags-Kundenumsatz × 0,9 × 0,4, Datenpunkt für das LohnTool.</small>
  </section>;
}

export function People({initialMonth}:{initialMonth:string}){
  const [year,setYear]=useState(initialMonth.slice(0,4));
  const [month,setMonth]=useState(initialMonth.slice(5));
  const [selected,setSelected]=useState<string|null>(null);
  const [reload,setReload]=useState(0);
  const [loaded,setLoaded]=useState<{year:string;rows:EmployeeCalendarRow[]}|null>(null);
  const [error,setError]=useState('');
  const rows=loaded?.year===year?loaded.rows:null;
  const period=month?year+'-'+month:null;
  const people=useMemo(()=>employeePeriod(rows??[],period),[rows,period]);

  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    api<EmployeeCalendarRow[]>('/api/employee-calendar?year='+year,{signal:controller.signal})
      .then(rows=>{if(!controller.signal.aborted)setLoaded({year,rows});})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[year,reload]);

  return <>
    <EmployeeAbsencesToday reload={reload}/>
    <PeriodCalendar title="Mitarbeiter-Kalender" year={year} month={month}
      onYear={value=>{setYear(value);setSelected(null);}} onMonth={value=>{setMonth(value);setSelected(null);}}
      onReload={()=>setReload(value=>value+1)}/>
    <section className="card sub-overview">
      <div className="row sub-calendar-header">
        <h2>Mitarbeiter · {period?monthLabel(period):year+' gesamt'}</h2><span className="spacer"/>
        {people.length>0&&<button type="button" className="btn" onClick={()=>
          download('/api/export?what=employee-calendar&year='+year+(period?'&month='+period:''))}>CSV</button>}
      </div>
      {error&&<p className="err" role="alert">{error}</p>}
      {rows===null&&!error&&<p role="status">Mitarbeiterdaten werden geladen …</p>}
      {rows!==null&&people.length===0&&<p>Für diesen Zeitraum liegen keine Mitarbeiterdaten vor.</p>}
      {people.length>0&&<>
        <div className="sub-table-scroll"><table>
          <thead><tr><th scope="col">Mitarbeiter</th><th scope="col">Umsatz 90 %</th><th scope="col">Ø realer Tagesumsatz</th>
            <th scope="col">Arbeitsstunden</th><th scope="col">Ø Arbeitsstunden pro Tag</th><th scope="col">Abwesenheit</th></tr></thead>
          <tbody>{people.map(person=>{
            const absence=absenceText(person.absences);
            return <tr key={person.id}>
              <th scope="row"><button type="button" className="sub-firm-toggle" aria-pressed={selected===person.id}
                onClick={()=>setSelected(selected===person.id?null:person.id)}>{person.name}</button> {person.code&&<span className="chip">{person.code}</span>}</th>
              <td>{money(person.revenue)}</td><td>{money(person.averageRevenue)}</td>
              <td>{person.minutes===null?'–':hours(person.minutes)+' h'}</td>
              <td>{person.averageMinutes===null?'–':hours(person.averageMinutes)+' h'}</td>
              <td>{absence||'–'}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className="muted">Tagesumsatz über Tage mit Umsatzbuchung oder Arbeitszeit. Durchschnittsstunden über Tage mit Arbeitszeit. U = Urlaub, UU = unbezahlter Urlaub, K = krank.</p>
      </>}
    </section>
    {period&&<MonthEvaluation month={period}/>}
    {people.length>0&&<EmployeeCalendar people={people.filter(person=>selected===null||person.id===selected)} period={period} year={year}/>}
  </>;
}
