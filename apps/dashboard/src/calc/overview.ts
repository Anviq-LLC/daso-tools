import type { EmployeeCalendarRow } from './employee-calendar.ts';
import type { EmpFact, SubFact } from './extract.ts';
import { perHead } from './rules.ts';

export function overviewDays(staff:EmployeeCalendarRow[],own:EmpFact[],subs:SubFact[],
  months:{target:number;dates:string[]}[],roles:ReadonlyMap<string,string|null|undefined>){
  const data=new Map<string,{own:number;sub:number;ownPeople:Set<string>;ownRevenueByPerson:Map<string,number>;subTeams:Map<string,number>;hasRevenue:boolean}>();
  function entry(day:string){
    const row=data.get(day)??{own:0,sub:0,ownPeople:new Set<string>(),ownRevenueByPerson:new Map<string,number>(),
      subTeams:new Map<string,number>(),hasRevenue:false};
    data.set(day,row);
    return row;
  }
  for(const person of staff)for(const day of person.days){
    if((day.minutes??0)>0)entry(day.day).ownPeople.add(person.id);
  }
  for(const fact of own){
    if(!fact.binding)continue;
    const row=entry(fact.day);
    row.own+=fact.customer;
    row.hasRevenue=true;
    if(fact.customer!==0){
      row.ownPeople.add(fact.resourceId);
      row.ownRevenueByPerson.set(fact.resourceId,(row.ownRevenueByPerson.get(fact.resourceId)??0)+fact.customer);
    }
  }
  for(const fact of subs){
    if(!fact.binding)continue;
    const row=entry(fact.day);
    const team=JSON.stringify([fact.projectId,fact.firm,fact.team]);
    row.sub+=fact.customer;
    row.hasRevenue=true;
    if(fact.heads||fact.customer!==0||fact.cost)row.subTeams.set(team,Math.max(fact.heads??0,row.subTeams.get(team)??0));
  }
  const normalizedRoles=new Map([...roles].map(([id,role])=>[id,role?.trim().toLowerCase()]));
  return months.flatMap(({target,dates})=>dates.map(day=>{
    const row=data.get(day);
    const own=row?.own??0,sub=row?.sub??0,ownHeads=row?.ownPeople.size??0;
    const teams=[...(row?.subTeams.values()??[])];
    const subHeads=teams.reduce((sum,count)=>sum+count,0);
    const subHeadsMissing=teams.includes(0);
    const total=own+sub,heads=ownHeads+subHeads;
    const ownRoles={m:{revenue:0,heads:0},om:{revenue:0,heads:0}};
    for(const id of row?.ownPeople??[]){
      const role=normalizedRoles.get(id);
      const group=role==='monteur'||role==='m'||role==='fitter'?ownRoles.m:
        role==='obermonteur'||role==='om'||role==='foreman'?ownRoles.om:null;
      if(!group)continue;
      group.heads++;
      group.revenue+=row?.ownRevenueByPerson.get(id)??0;
    }
    const weekday=new Date(day+'T12:00:00Z').getUTCDay();
    return {day,own,sub,total,ownHeads,ownRoles,subHeads,heads,subHeadsMissing,hasRevenue:row?.hasRevenue??false,
      ownPerHead:perHead(own,ownHeads),subPerHead:subHeadsMissing?null:perHead(sub,subHeads),
      perHead:subHeadsMissing?null:perHead(total,heads),target:weekday>0&&weekday<6?target:null};
  }));
}

export type OverviewDay=ReturnType<typeof overviewDays>[number];

export function overviewRevenue(days:OverviewDay[]){
  let own=0,sub=0,ownHeads=0,subHeads=0;
  let mRevenue=0,mDays=0,omRevenue=0,omDays=0;
  for(const day of days){
    own+=day.own;sub+=day.sub;ownHeads+=day.ownHeads;subHeads+=day.subHeads;
    mRevenue+=day.ownRoles.m.revenue;mDays+=day.ownRoles.m.heads;
    omRevenue+=day.ownRoles.om.revenue;omDays+=day.ownRoles.om.heads;
  }
  const subHeadsMissing=days.some(day=>day.subHeadsMissing);
  return {own,sub,total:own+sub,hasRevenue:days.some(day=>day.hasRevenue),
    ownPerHead:perHead(own,ownHeads),mPerHead:perHead(mRevenue,mDays),omPerHead:perHead(omRevenue,omDays),
    subPerHead:subHeadsMissing?null:perHead(sub,subHeads),
    totalPerHead:subHeadsMissing?null:perHead(own+sub,ownHeads+subHeads)};
}

export function overviewRevenueForecast(total:number|null,actual:{own:number;sub:number}){
  const ownWeight=Math.max(0,actual.own),subWeight=Math.max(0,actual.sub);
  const weight=ownWeight+subWeight;
  if(total===null||weight===0)return {total,own:null,sub:null};
  const own=actual.own+Math.round((total-actual.own-actual.sub)*ownWeight/weight);
  return {total,own,sub:total-own};
}
