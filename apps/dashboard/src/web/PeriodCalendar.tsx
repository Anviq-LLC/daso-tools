const months=Array.from({length:12},(_,index)=>String(index+1).padStart(2,'0'));
const monthNames=new Intl.DateTimeFormat('de-DE',{month:'long',timeZone:'UTC'});

export function PeriodCalendar({title,year,month,onYear,onMonth,onReload}:{
  title:string;year:string;month:string;onYear:(year:string)=>void;onMonth:(month:string)=>void;onReload:()=>void;
}){
  return <section className="card sub-calendar" aria-label={title}>
    <div className="row sub-calendar-header">
      <h2>{title}</h2><span className="spacer"/>
      <button className="btn" type="button" aria-label="Vorjahr" disabled={year==='2000'} onClick={()=>onYear(String(Number(year)-1))}>‹</button>
      <strong aria-live="polite">{year}</strong>
      <button className="btn" type="button" aria-label="Folgejahr" disabled={year==='2100'} onClick={()=>onYear(String(Number(year)+1))}>›</button>
      <button className="btn" type="button" onClick={onReload}>Neu laden</button>
    </div>
    <button type="button" className={month?'btn':'btn primary'} aria-pressed={!month} onClick={()=>onMonth('')}>Ganzes Jahr</button>
    <div className="sub-months" role="group" aria-label="Monat auswählen">
      {months.map(value=><button type="button" key={value} className={month===value?'btn primary':'btn'}
        aria-pressed={month===value} onClick={()=>onMonth(value)}>
        {monthNames.format(new Date('2000-'+value+'-15T12:00:00Z'))}
      </button>)}
    </div>
  </section>;
}
