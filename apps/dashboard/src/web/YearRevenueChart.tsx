import { useId } from 'react';
import { money, monthLabel } from './api.ts';
import type { YearPoint } from '../calc/forecast.ts';

type RevenuePoint = Omit<YearPoint,'revenue'> & { revenue:number|null };
const shortMonth=new Intl.DateTimeFormat('de-DE',{month:'short',timeZone:'UTC'});
const axisEuro=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0});

export function YearRevenueChart({points}:{points:RevenuePoint[]}){
  const hatch=useId();
  const values=points.flatMap(point=>point.revenue===null?[]:[point.revenue]);
  const low=Math.min(0,...values),high=Math.max(0,...values);
  const desired=Math.max(100,(high-low)/5);
  const magnitude=10**Math.floor(Math.log10(desired));
  const step=([1,2,2.5,5,10].find(value=>value*magnitude>=desired)??10)*magnitude;
  const min=Math.floor(low/step)*step,max=high===0&&low===0?step:Math.ceil(high/step)*step;
  const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,index)=>min+index*step);
  const width=1152,height=305,left=108,right=12,top=28,bottom=252;
  const slot=(width-left-right)/Math.max(1,points.length);
  const bar=Math.min(44,slot*0.56);
  const y=(value:number)=>bottom-(value-min)*(bottom-top)/(max-min);
  const zero=y(0);
  return <figure className="year-revenue">
    <div className="row year-revenue-legend">
      <span className="overview-legend"><span className="legend-own"/>Ist-Umsatz</span>
      <span className="overview-legend"><span className="legend-forecast"/>Prognose</span>
    </div>
    <div className="year-revenue-scroll" tabIndex={0} role="region" aria-label="Monatsumsätze, horizontal scrollbar">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="group" aria-label="Monatsumsatz in Euro">
        <defs><pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="7" fill="var(--accent)" opacity=".55"/>
        </pattern></defs>
        {ticks.map(tick=><g key={tick}>
          <line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={tick===0?2:1}/>
          <text x={left-10} y={y(tick)+4} textAnchor="end">{axisEuro.format(tick/100)}</text>
        </g>)}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="var(--line)"/>
        {points.map(({month,kind,revenue},index)=>{
          const x=left+(index+0.5)*slot;
          const coordinate=y(revenue??0);
          const forecast=kind!=='ist';
          const description=monthLabel(month)+' · '+(revenue===null?'Kein Umsatzwert':(forecast?'Prognose ':'Ist-Umsatz ')+money(revenue));
          return <g key={month} role="img" aria-label={description}>
            <title>{description}</title>
            {revenue!==null&&<rect x={x-bar/2} y={Math.min(zero,coordinate)} width={bar} height={Math.abs(zero-coordinate)} rx="2"
              fill={forecast?`url(#${hatch})`:'var(--accent)'} stroke={forecast&&revenue!==0?'var(--accent)':undefined}/>}
            <text className="year-revenue-value" x={x} y={coordinate+((revenue??0)<0?16:-8)} textAnchor="middle">{money(revenue)}</text>
            <text className="year-revenue-month" x={x} y={height-10} textAnchor="middle">
              {shortMonth.format(new Date(month+'-15T12:00:00Z'))}
            </text>
          </g>;
        })}
      </svg>
    </div>
    <figcaption>BWA-Umsatz hat je Monat Vorrang. Ab KW 52 rechnet die Prognose zwei Wochen ohne Umsatz.</figcaption>
  </figure>;
}
