import type { EmpFact, SubFact } from './extract.ts';
import { readPlanDayEntry, type Assignment, type HoursFact, type PlanDayEntry } from './plan.ts';

export type ProjectPeriod = {from:string;to:string};
export type ProjectHours = Pick<HoursFact,'day'|'resourceId'|'projectId'|'minutes'>;

const dayKey=(person:string,day:string)=>person+'|'+day;
const projectKey=(row:ProjectHours)=>dayKey(row.resourceId,row.day)+'|'+row.projectId;
const projectWeekday=(day:string)=>new Date(day+'T12:00:00Z').getUTCDay();

export function shiftProjectDay(day:string,delta:number){
  const value=new Date(day+'T12:00:00Z');
  value.setUTCDate(value.getUTCDate()+delta);
  return value.toISOString().slice(0,10);
}
export function projectWeek(day:string):ProjectPeriod{
  const weekday=projectWeekday(day);
  const from=shiftProjectDay(day,-((weekday+6)%7));
  return {from,to:shiftProjectDay(from,6)};
}

export function contractorHeadcounts(assignments:Assignment[],contractors:ReadonlySet<string>,date:string){
  const totals=new Map<string,number|null>();
  const counted=new Set<string>();
  for(const row of assignments){
    if(row.day!==date||row.assignment_type!=='project'||!row.project_id||!contractors.has(row.resource_id))continue;
    const key=JSON.stringify([row.project_id,row.resource_id]);
    if(counted.has(key))continue;
    counted.add(key);
    const total=totals.get(row.project_id);
    const count=row.count;
    totals.set(row.project_id,total===null||count==null||!Number.isSafeInteger(count)||count<1?null:(total??0)+count);
  }
  return totals;
}
export function projectMonth(month:string):ProjectPeriod{
  const [year,index]=month.split('-').map(Number);
  return {from:month+'-01',to:new Date(Date.UTC(year,index,0)).toISOString().slice(0,10)};
}

export function projectStaffing(assignments:Assignment[],employees:ReadonlySet<string>){
  const projects=new Map<string,Map<string,Set<string>>>();
  for(const row of assignments){
    if(row.assignment_type!=='project'||!row.project_id||!employees.has(row.resource_id))continue;
    const days=projects.get(row.project_id)??new Map<string,Set<string>>();
    const staff=days.get(row.day)??new Set<string>();
    staff.add(row.resource_id);
    days.set(row.day,staff);
    projects.set(row.project_id,days);
  }
  return projects;
}

export function averageProjectStaff(days:Map<string,Set<string>>|undefined,period:ProjectPeriod){
  const counts=[...(days??[])].filter(([day])=>day>=period.from&&day<=period.to).map(([,staff])=>staff.size);
  return counts.length?counts.reduce((sum,heads)=>sum+heads,0)/counts.length:null;
}

export function projectSubFigures(rows:SubFact[],{from,to}:ProjectPeriod,today:string){
  const matching=rows.filter(row=>row.binding&&row.day>=from&&row.day<=to&&row.day<=today);
  const costs=matching.flatMap(row=>row.cost===null?[]:[row.cost]);
  const subCostMissing=costs.length!==matching.length;
  const subRevenue=matching.length?matching.reduce((sum,row)=>sum+row.customer,0):null;
  const subCost=costs.length?costs.reduce((sum,cost)=>sum+cost,0):null;
  return {
    subRevenue,subCost,subCostMissing,
    result:subRevenue!==null&&subCost!==null&&!subCostMissing?subRevenue-subCost:null,
    hasActivity:matching.some(row=>row.customer!==0||(row.cost??0)!==0),
  };
}

export function projectHours(punches:HoursFact[],assignments:Assignment[],entries:PlanDayEntry[],entered:ProjectHours[]){
  const byPunch=new Map<string,ProjectHours>();
  const punchedProjects=new Map<string,Set<string>>();
  const assignedProjects=new Map<string,Set<string>>();
  for(const row of assignments){
    if(row.assignment_type!=='project'||!row.project_id)continue;
    const key=dayKey(row.resource_id,row.day);
    const projects=assignedProjects.get(key)??new Set<string>();
    projects.add(row.project_id);
    assignedProjects.set(key,projects);
  }
  for(const row of punches){
    if(row.travel||!row.projectId)continue;
    const key=dayKey(row.resourceId,row.day);
    const projects=punchedProjects.get(key)??new Set<string>();
    projects.add(row.projectId);
    punchedProjects.set(key,projects);
    if(row.open||row.minutes<=0)continue;
    const itemKey=projectKey(row);
    byPunch.set(itemKey,{...row,minutes:(byPunch.get(itemKey)?.minutes??0)+row.minutes});
  }
  const combined=new Map(entered.map(row=>[projectKey(row),row]));
  for(const [key,row] of byPunch)combined.set(key,row);

  for(const entry of entries){
    const fields=readPlanDayEntry(entry);
    if(!fields)continue;
    const key=dayKey(entry.resource_id,entry.day);
    const candidates=punchedProjects.get(key)??assignedProjects.get(key);
    const projectId=fields.projectId||(candidates?.size===1?[...candidates][0]:null);
    if(!projectId)continue;
    const row={day:entry.day,resourceId:entry.resource_id,projectId,minutes:fields.minutes};
    combined.set(projectKey(row),row);
  }
  return [...combined.values()];
}

export function projectFigures(input:{
  period:ProjectPeriod;today:string;hours:ProjectHours[];staff?:Map<string,Set<string>>;
  own:EmpFact[];subs:SubFact[];hourlyCents:number;employerPct:number;
}){
  const {from,to}=input.period;
  const includes=(day:string)=>day>=from&&day<=to&&day<=input.today;
  const own=input.own.filter(row=>row.binding&&includes(row.day));
  const subs=input.subs.filter(row=>row.binding&&includes(row.day));
  const hours=input.hours.filter(row=>includes(row.day));
  const settled=new Set(hours.map(row=>dayKey(row.resourceId,row.day)));
  const expected=new Set(own.map(row=>dayKey(row.resourceId,row.day)));
  for(const [day,staff] of input.staff??[]){
    if(includes(day))for(const person of staff)expected.add(dayKey(person,day));
  }
  const missingHours=[...expected].filter(key=>!settled.has(key)).length;
  const bookedMinutes=hours.reduce((sum,row)=>sum+row.minutes,0);
  const ownCost=hours.length?Math.round(bookedMinutes*input.hourlyCents*(1+input.employerPct/100)/60):missingHours?null:0;
  const subCostMissing=subs.some(row=>row.cost===null);
  const subCost=subs.reduce((sum,row)=>sum+(row.cost??0),0);
  const ownRevenue=own.reduce((sum,row)=>sum+row.customer,0);
  const subRevenue=subs.reduce((sum,row)=>sum+row.customer,0);
  const revenue=ownRevenue+subRevenue;
  const hasData=!!(own.length||subs.length||hours.length||expected.size);
  return {
    revenue:hasData?revenue:null,ownRevenue:hasData?ownRevenue:null,subRevenue:hasData?subRevenue:null,
    subCost:hasData&&(!subCostMissing||subs.some(row=>row.cost!==null))?subCost:null,subCostMissing,
    bookedMinutes:hours.length?bookedMinutes:null,ownCost:hasData?ownCost:null,missingHours,
    result:hasData&&ownCost!==null&&!subCostMissing?revenue-ownCost-subCost:null,
  };
}
