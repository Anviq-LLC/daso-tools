import type { SubFact } from './extract.ts';
import { projectWeek } from './project-dashboard.ts';
import { perHead } from './rules.ts';

type Basis = NonNullable<SubFact['basis']>;
export type SubCalendarDay = {
  firm:string; projectId:string; project:string; team:string; day:string; basis:Basis;
  revenue:number; cost:number|null; heads:number|null; estimated:boolean;
};

function grouped<T>(rows:T[],key:(row:T)=>string){
  const groups=new Map<string,T[]>();
  for(const row of rows){
    const name=key(row);
    const group=groups.get(name)??[];
    group.push(row);
    groups.set(name,group);
  }
  return groups;
}

const sum=(values:number[])=>values.reduce((total,value)=>total+value,0);
const deploymentKey=(row:SubCalendarDay)=>JSON.stringify([row.day,row.projectId,row.team]);

export function subCalendarDays(facts:SubFact[],year:string){
  const rows=facts.filter(row=>row.binding&&row.day.startsWith(year+'-'));
  return [...grouped(rows,row=>JSON.stringify([row.firm,row.projectId,row.team,row.day,row.basis??'performance'])).values()]
    .map((group):SubCalendarDay=>{
      const row=group[0];
      return {firm:row.firm,projectId:row.projectId,project:row.label,team:row.team,day:row.day,basis:row.basis??'performance',
        revenue:sum(group.map(item=>item.customer)),cost:group.some(item=>item.cost===null)?null:sum(group.map(item=>item.cost??0)),
        heads:Math.max(...group.map(item=>item.heads??0))||null,estimated:group.some(item=>item.estimated)};
    }).sort((a,b)=>a.day.localeCompare(b.day));
}

export function subCalendarMetrics(rows:SubCalendarDay[]){
  const counts=[...grouped(rows,deploymentKey).values()].map(group=>Math.max(...group.map(row=>row.heads??0)));
  const personDays=sum(counts);
  const denominator=counts.includes(0)?null:personDays;
  const revenue=sum(rows.map(row=>row.revenue));
  const cost=rows.some(row=>row.cost===null)?null:sum(rows.map(row=>row.cost??0));
  const profit=cost===null?null:revenue-cost;
  return {revenue,cost,profit,personDays,averageRevenue:perHead(revenue,denominator),
    averageCost:cost===null?null:perHead(cost,denominator),averageProfit:profit===null?null:perHead(profit,denominator),
    days:new Set(rows.map(row=>row.day)).size,projects:new Set(rows.map(row=>row.projectId)).size};
}

export function subCalendarFirms(rows:SubCalendarDay[]){
  return [...grouped(rows,row=>row.firm)].map(([firm,days])=>({firm,rows:days,...subCalendarMetrics(days)}))
    .sort((a,b)=>b.revenue-a.revenue||a.firm.localeCompare(b.firm,'de'));
}

export function subCalendarWeeks(rows:SubCalendarDay[]){
  return [...grouped(rows,row=>projectWeek(row.day).from)].sort(([a],[b])=>a.localeCompare(b)).map(([week,days])=>({
    week,...subCalendarMetrics(days),
    byProject:[...grouped(days,row=>row.projectId)].map(([id,projectDays])=>({
      id,name:projectDays[0].project,rows:projectDays,...subCalendarMetrics(projectDays),
    })).sort((a,b)=>a.name.localeCompare(b.name,'de',{numeric:true})),
  }));
}
