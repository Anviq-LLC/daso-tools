import { useState } from 'react';
import { money } from './api.ts';

type RevenuePoint={id:string;label:string;detail:string;own:number;sub:number};
const axisMoney=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0});

export function RevenueChart({points,title}:{points:RevenuePoint[];title:string}){
  const [active,setActive]=useState<string|null>(null);
  const [stacked,setStacked]=useState(false);
  const selected=points.find(point=>point.id===active);
  const bars=points.map(point=>{
    const sameDirection=(point.own<0)===(point.sub<0);
    const subStart=stacked&&sameDirection?point.own:0;
    return {point,subStart,subEnd:subStart+point.sub};
  });
  const values=bars.flatMap(({point,subEnd})=>[point.own,subEnd]);
  const lower=Math.min(0,...values),upper=Math.max(0,...values);
  const desired=Math.max(100,(upper-lower)/5);
  const magnitude=10**Math.floor(Math.log10(desired));
  const step=([1,2,2.5,5,10].find(value=>value*magnitude>=desired)??10)*magnitude;
  const min=Math.floor(lower/step)*step;
  const max=Math.max(step,Math.ceil(upper/step)*step);
  const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,i)=>min+i*step);
  const left=82,right=10,top=10,bottom=246;
  const width=Math.max(610,left+right+points.length*28);
  const groupWidth=(width-left-right)/Math.max(1,points.length);
  const barWidth=Math.min(stacked?40:24,groupWidth*(stacked?0.64:0.32));
  const y=(value:number)=>bottom-(value-min)*(bottom-top)/(max-min);
  return <section className="card overview-chart">
    <div className="row overview-chart-heading">
      <h2>{title}</h2><span className="spacer"/>
      <span className="overview-legend"><span className="legend-own"/>Mitarbeiter</span>
      <span className="overview-legend"><span className="legend-sub"/>Nachunternehmer</span>
      <div className="overview-chart-mode" role="group" aria-label="Umsatzdarstellung">
        <button type="button" className={'btn'+(!stacked?' primary':'')} aria-pressed={!stacked} onClick={()=>setStacked(false)}>Nebeneinander</button>
        <button type="button" className={'btn'+(stacked?' primary':'')} aria-pressed={stacked} onClick={()=>setStacked(true)}>Gestapelt</button>
      </div>
    </div>
    <div className="overview-chart-scroll">
      <svg width="100%" viewBox={`0 0 ${width} 272`} style={{minWidth:width}} role="group" aria-label={title+' in Euro'}>
        {ticks.map(tick=><g key={tick}>
          <line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={tick===0?2:1}/>
          <text x={left-8} y={y(tick)+4} textAnchor="end">{axisMoney.format(tick/100)}</text>
        </g>)}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="var(--line)"/>
        {bars.map(({point,subStart,subEnd},index)=>{
          const x=left+index*groupWidth;
          const middle=x+groupWidth/2;
          const description=point.detail+' · Mitarbeiter '+money(point.own)+' · Nachunternehmer '+money(point.sub)+' · Gesamt '+money(point.own+point.sub);
          return <g key={point.id}>
            <rect x={stacked?middle-barWidth/2:middle-barWidth-1} y={Math.min(y(0),y(point.own))} width={barWidth} height={Math.abs(y(point.own)-y(0))} fill="var(--accent)" rx={stacked?0:2}/>
            <rect x={stacked?middle-barWidth/2:middle+1} y={Math.min(y(subStart),y(subEnd))} width={barWidth} height={Math.abs(y(subEnd)-y(subStart))} fill="var(--amber)" rx={stacked?0:2}/>
            <text x={middle} y={265} textAnchor="middle">{point.label}</text>
            <rect className="overview-chart-mark" x={x} y={top} width={groupWidth} height={bottom-top}
              fill="transparent" role="img" tabIndex={0} aria-label={description}
              onMouseEnter={()=>setActive(point.id)} onMouseLeave={()=>setActive(null)}
              onFocus={()=>setActive(point.id)} onBlur={()=>setActive(null)}><title>{description}</title></rect>
          </g>;
        })}
      </svg>
    </div>
    <div className="overview-chart-readout" aria-live="polite">
      {selected&&<><strong>{selected.detail}</strong><span>Mitarbeiter {money(selected.own)}</span>
        <span>Nachunternehmer {money(selected.sub)}</span><span>Gesamt {money(selected.own+selected.sub)}</span></>}
    </div>
  </section>;
}
