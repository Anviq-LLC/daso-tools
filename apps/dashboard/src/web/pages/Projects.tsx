import { useEffect, useState } from 'react';
import { api, money } from '../api.ts';

type ProjectRoster = { id: string; name: string; archived: boolean; start: string | null; today: number; contractorsToday: number | null; revenue: number; order: number | null }[];
const dateFormat = new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeZone:'UTC'});
const amountFormat = new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
const percentFormat = new Intl.NumberFormat('de-DE',{style:'percent',maximumFractionDigits:1});
function orderCents(value:string){
  const input=value.trim();
  if(!input)return null;
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(input))return NaN;
  const [euros,fraction='']=input.replaceAll('.','').split(',');
  const cents=Number(euros)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(cents)&&cents>0?cents:NaN;
}

function OrderAmount({project,value,onSave}:{project:string;value?:number;onSave:(value:number|null)=>void}){
  const [draft,setDraft]=useState(()=>value===undefined?'':amountFormat.format(value/100));
  const [error,setError]=useState('');
  function save(){
    const cents=orderCents(draft);
    if(Number.isNaN(cents)){setError('Bitte einen positiven Betrag eingeben.');return;}
    if(cents!==(value??null))onSave(cents);
    setDraft(cents===null?'':amountFormat.format(cents/100));
    setError('');
  }
  return <>
    <input className="project-order" type="text" inputMode="decimal" value={draft} placeholder="€"
      aria-label={'Auftragswert für '+project} aria-invalid={!!error} onBlur={save}
      onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}
      onChange={event=>{setDraft(event.target.value);setError('');}}/>
    {error&&<small role="alert" className="err year-figure-detail">{error}</small>}
  </>;
}

function Remaining({revenue,order}:{revenue:number;order?:number}){
  if(!order)return <>–</>;
  const difference=order-revenue;
  if(difference===0)return <>0 % offen</>;
  const text=percentFormat.format(Math.abs(difference)/order);
  return difference<0?<span className="err">{text} drüber</span>:<>{text} offen</>;
}

export function Projects({canEdit}:{canEdit:boolean}){
  const [projects,setProjects]=useState<ProjectRoster|null>(null);
  const [error,setError]=useState('');
  const [showArchived,setShowArchived]=useState(false);
  const visible=projects?.filter(project=>project.archived===showArchived);

  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    api<ProjectRoster>('/api/project-roster',{signal:controller.signal})
      .then(rows=>{if(!controller.signal.aborted)setProjects(rows);})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[]);

  async function saveOrder(id:string,cents:number|null){
    try{
      await api('/api/project-order',{method:'PUT',json:{projectId:id,cents}});
      setProjects(rows=>rows&&rows.map(row=>row.id===id?{...row,order:cents}:row));
    }catch(error){setError((error as Error).message);}
  }

  return <section className="card project-overview">
    <div className="row project-overview-header">
      <h2>Projektübersicht</h2><span className="spacer"/>
      <div role="group" aria-label="Projektstatus" className="row">
        <button type="button" className={showArchived?'btn':'btn primary'} aria-pressed={!showArchived} onClick={()=>setShowArchived(false)}>Aktiv</button>
        <button type="button" className={showArchived?'btn primary':'btn'} aria-pressed={showArchived} onClick={()=>setShowArchived(true)}>Archiviert</button>
      </div>
    </div>
    {error&&<p role="alert" className="err">{error}</p>}
    {projects===null&&!error&&<p role="status">Projekte und Einsatzplan werden geladen …</p>}
    {visible?.length===0&&<p>{showArchived?'Keine archivierten Projekte.':'Keine Projekte mit laufendem oder geplantem Einsatz.'}</p>}
    {!!visible?.length&&<>
      <div className="scroll"><table>
        <thead><tr>
          <th scope="col">Projekt</th><th scope="col">Erster Einsatz</th>
          <th scope="col">Mitarbeiter</th><th scope="col">NU-Mitarbeiter</th>
          <th scope="col">Gesamtumsatz bisher</th><th scope="col">Auftragswert</th><th scope="col">Offen / drüber</th>
        </tr></thead>
        <tbody>{visible.map(project=><tr key={project.id}>
          <th scope="row">{project.name}</th>
          <td>{project.start?dateFormat.format(new Date(project.start+'T12:00:00Z')):'–'}</td>
          <td>{project.today}</td>
          <td title={project.contractorsToday===null?'Personenzahl im Einsatzplan fehlt':undefined}>{project.contractorsToday??'–'}</td>
          <td>{money(project.revenue)}</td>
          <td>{canEdit?<OrderAmount project={project.name} value={project.order??undefined} onSave={value=>saveOrder(project.id,value)}/>:money(project.order)}</td>
          <td><Remaining revenue={project.revenue} order={project.order??undefined}/></td>
        </tr>)}</tbody>
      </table></div>
      <p className="muted">Mitarbeiterzahlen für heute laut Einsatzplan.</p>
    </>}
  </section>;
}
