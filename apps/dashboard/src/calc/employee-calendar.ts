import type { EmpFact } from './extract.ts';
import { absenceFacts, readPlanDayEntry, type Assignment, type HoursFact, type PlanDayEntry } from './plan.ts';

export const employeeAbsences={vacation:'U',unpaid:'UU',sick:'K'} as const;
type AbsenceCode=keyof typeof employeeAbsences;
export type EmployeeDay={day:string;revenue:number;hasRevenue:boolean;minutes:number|null;absence:AbsenceCode|null};
export type EmployeeCalendarRow={id:string;name:string;code:string;days:EmployeeDay[]};

export function employeeCalendarRows(input:{
  resources:{id:string;name:string;code:string}[]; revenue:EmpFact[];
  hours:HoursFact[]; manual:PlanDayEntry[]; assignments:Assignment[]; from:string;to:string;
}):EmployeeCalendarRow[]{
  const resources=new Map(input.resources.map(person=>[person.id,person]));
  const people=new Map<string,Map<string,EmployeeDay>>();
  const inPeriod=(day:string)=>day>=input.from&&day<=input.to;
  function daily(id:string,day:string){
    const days=people.get(id)??new Map<string,EmployeeDay>();
    const row=days.get(day)??{day,revenue:0,hasRevenue:false,minutes:null,absence:null};
    days.set(day,row);
    people.set(id,days);
    return row;
  }

  for(const row of input.revenue){
    if(!row.binding||!inPeriod(row.day))continue;
    if(!resources.has(row.resourceId))resources.set(row.resourceId,{id:row.resourceId,name:row.name,code:row.code});
    const day=daily(row.resourceId,row.day);
    day.revenue+=row.employee;
    day.hasRevenue=true;
  }
  for(const row of input.hours){
    if(!resources.has(row.resourceId)||row.travel||row.open||!Number.isFinite(row.minutes)||row.minutes<=0||!inPeriod(row.day))continue;
    const day=daily(row.resourceId,row.day);
    day.minutes=(day.minutes??0)+row.minutes;
  }
  for(const row of input.manual){
    if(!resources.has(row.resource_id)||!inPeriod(row.day))continue;
    const entry=readPlanDayEntry(row);
    if(entry)daily(row.resource_id,row.day).minutes=entry.minutes;
  }
  for(const row of absenceFacts(input.assignments,null)){
    if(!resources.has(row.resourceId)||!inPeriod(row.day))continue;
    if(Object.hasOwn(employeeAbsences,row.kind))daily(row.resourceId,row.day).absence=row.kind as AbsenceCode;
  }

  return [...people].map(([id,days])=>({...resources.get(id)!,days:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day))}));
}

export function employeeMetrics(days:EmployeeDay[]){
  let revenue=0,minutes=0,workDays=0,revenueDays=0;
  const absences={vacation:0,unpaid:0,sick:0};
  for(const day of days){
    revenue+=day.revenue;
    const worked=(day.minutes??0)>0;
    if(worked){minutes+=day.minutes!;workDays++;}
    if(worked||day.hasRevenue)revenueDays++;
    if(day.absence)absences[day.absence]++;
  }
  return {revenue,minutes:workDays?minutes:null,averageMinutes:workDays?Math.round(minutes/workDays):null,
    averageRevenue:revenueDays?Math.round(revenue/revenueDays):null,absences};
}

export function employeePeriod(rows:EmployeeCalendarRow[],month:string|null){
  return rows.map(row=>{
    const days=month===null?row.days:row.days.filter(day=>day.day.startsWith(month+'-'));
    return {...row,days,...employeeMetrics(days)};
  }).filter(row=>row.days.length>0).sort((a,b)=>b.revenue-a.revenue||a.name.localeCompare(b.name,'de'));
}
