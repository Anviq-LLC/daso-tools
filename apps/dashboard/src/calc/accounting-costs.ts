import type { AccountingReport } from './accounting-pdf.ts';
import { adjustForWinterClosure } from './forecast.ts';

export const costColumns = [
  ['staff','Mitarbeiter'], ['subs','Nachunternehmer'], ['vehicles','Kfz'],
  ['office','Büro'], ['general','Allgemeine Kosten'], ['other','Sonstige Kosten'],
] as const;
type Category = (typeof costColumns)[number][0];
type Costs = Record<Category,number|null>;
type Bwa = Extract<AccountingReport,{kind:'bwa'}>;
type Susa = Extract<AccountingReport,{kind:'susa'}>;
type CostMonth = {period:string;costs:Costs;equipment:number|null;total:number|null;source:string;kind:'actual'|'forecast'|'missing'};
const sum=(values:(number|null)[])=>values.reduce<number>((total,value)=>total+(value??0),0);
const anySum=(values:(number|null)[])=>values.some(value=>value!==null)?sum(values):null;
const zero=(value:number|null)=>value??0;
const emptyCosts=():Costs=>({staff:null,subs:null,vehicles:null,office:null,general:null,other:null});
const equipmentLabel=/^(?:Werkzeug(?:e|kosten)?\b|Werkz\.|Kleingeräte\b)/i;

export function otherYearCosts({costs,equipment}:CostMonth){
  return costs.general===null&&costs.other===null?null:sum([costs.general,costs.other])-zero(equipment);
}

function accountCategory(account:string):Category|undefined {
  const number=Number(account);
  if (/^31\d{2}$/.test(account))return 'subs';
  if (number>=4100&&number<4200)return 'staff';
  if (number>=4500&&number<4600||number===4832)return 'vehicles';
  if (number>=4200&&number<4300||[4806,4910,4920,4925,4930].includes(number))return 'office';
  if (number>=4300&&number<4500||number>=4600&&number<4700||[4945,4950,4955,4957,4970].includes(number))return 'general';
  if (number>=3000&&number<4100||number>=4700&&number<5000)return 'other';
}

function summarize(bwa:Bwa|undefined,susa:Susa|undefined,column:'month'|'ytd') {
  const balances=new Map<string,number>();
  for(const row of susa?.rows??[]){
    if(!accountCategory(row.account))continue;
    if(column==='month')balances.set(row.account,row.debit-row.credit);
    else if(row.ytdDebit!==null&&row.ytdCredit!==null)balances.set(row.account,row.ytdDebit-row.ytdCredit);
  }
  const subAccounts=(accounts:string[])=>anySum(accounts.map(account=>balances.get(account)??null));
  const accounts=[...balances].flatMap(([account,cents])=>{
    const category=accountCategory(account);
    return category?[{category,cents}]:[];
  });
  const fromSusa=(category:Category)=>accounts.length?sum(accounts.filter(row=>row.category===category).map(row=>row.cents)):null;
  const equipmentFromSusa=accounts.length?sum([...new Set((susa?.rows??[])
    .filter(row=>accountCategory(row.account)==='other'&&(Number(row.account)===4985||equipmentLabel.test(row.label.trim())))
    .map(row=>row.account))].map(account=>balances.get(account)??null)):null;
  const rows=bwa?.rows??[];
  const line=(pattern:RegExp)=>rows.find(row=>pattern.test(row.label.trim()))?.[column]??null;
  const components=(patterns:RegExp[])=>anySum(patterns.map(line));
  const equipment=line(equipmentLabel)??equipmentFromSusa;

  const purchases=line(/^(Wareneinsatz|Mat\.?\s*\/\s*Wareneinkauf|Material-?\s*\/\s*Wareneinkauf)$/i);
  const operating=line(/^Gesamtkosten$/i);
  const staff=line(/^Personalkosten$/i)??fromSusa('staff');
  const rooms=line(/^Raumkosten$/i);
  const vehicles=line(/^Fahrzeugko/i);
  const taxes=line(/^Betriebl(?:iche)?\.?\s*Steuern$/i);
  const vehicleTax=line(/^Kfz[- ]Steuern/i)??subAccounts(['4510']);
  const vehicleDepreciation=line(/^Abschreibungen auf Fahrzeuge/i)??subAccounts(['4832']);
  const subDetails=components([/^Fremdleistungen$/i,/^(?:div\.\s*)?SUBS\b/i,/^Leistungen ausl\.\s*UN/i,/^Erhalt\.?\s+Skonti nach §\s*13b/i]);
  const insurance=line(/^Versich(?:erungen)?\.?\s*\/\s*Beiträge$/i);
  const adsAndTravel=line(/^Werbe-?\s*\/\s*Reisekosten$/i);
  const officeDetails=[
    line(/^Wartungskosten für Hard/i)??subAccounts(['4806']),
    line(/^Porto$/i)??subAccounts(['4910']),line(/^Telefon$/i)??subAccounts(['4920']),
    line(/^Internetkosten$/i)??subAccounts(['4925']),line(/^Bürobedarf$/i)??subAccounts(['4930']),
  ];
  const generalDetails=[
    line(/^Fortbildungskosten$/i)??subAccounts(['4945']),
    line(/^Rechts- und Beratungskosten$/i)??subAccounts(['4950']),
    line(/^Buchführungskosten$/i)??subAccounts(['4955']),
    line(/^Abschluss- und Prüfungskosten$/i)??subAccounts(['4957']),
    line(/^Nebenkosten des Geldverkehrs$/i)??subAccounts(['4970']),
  ];
  const costs:Costs={
    staff,
    subs:subDetails??fromSusa('subs')??(purchases===0?0:null),
    vehicles:vehicles===null?fromSusa('vehicles'):sum([vehicles,vehicleTax,vehicleDepreciation]),
    office:rooms===null?fromSusa('office'):sum([rooms,...officeDetails]),
    general:insurance===null&&adsAndTravel===null&&taxes===null?fromSusa('general'):
      sum([insurance,adsAndTravel,taxes===null?null:taxes-zero(vehicleTax),...generalDetails]),
    other:fromSusa('other'),
  };
  if(operating!==null&&purchases!==null){
    const total=operating+purchases;
    costs.other=total-sum(costColumns.filter(([key])=>key!=='other').map(([key])=>costs[key]));
    return {costs,equipment,total,source:susa?'BWA + SuSa':'BWA'};
  }
  if(accounts.length){
    const costs=emptyCosts();
    for(const [key] of costColumns)costs[key]=fromSusa(key);
    return {costs,equipment:equipmentFromSusa,total:sum(accounts.map(row=>row.cents)),source:'SuSa'};
  }
  return null;
}

export function accountingCosts(reports:AccountingReport[],year:string,currentMonth:string){
  const archive=new Map<string,{bwa?:Bwa;susa?:Susa}>();
  for(const report of reports){
    const pair=archive.get(report.period)??{};
    if(report.kind==='bwa')pair.bwa=report;else pair.susa=report;
    archive.set(report.period,pair);
  }
  const observed=new Map<string,CostMonth>();
  for(const [period,{bwa,susa}] of archive){
    const summary=summarize(bwa,susa,'month');
    if(!summary)continue;
    observed.set(period,{period,...summary,kind:'actual'});
    const january=period.slice(0,4)+'-01';
    if(!period.endsWith('-02')||archive.has(january))continue;
    const cumulative=summarize(bwa,susa,'ytd');
    if(!cumulative||cumulative.source!==summary.source)continue;
    const costs={...summary.costs};
    for(const [key] of costColumns){
      const ytd=cumulative.costs[key], month=summary.costs[key];
      costs[key]=ytd===null||month===null?null:ytd-month;
    }
    const equipment=cumulative.equipment===null||summary.equipment===null?null:cumulative.equipment-summary.equipment;
    observed.set(january,{period:january,costs,equipment,total:cumulative.total-summary.total,source:summary.source+' · abgeleitet',kind:'actual'});
  }
  const lastYear=String(Number(currentMonth.slice(0,4))-1)+currentMonth.slice(4);
  const recent=[...observed.values()].filter(row=>row.period<currentMonth&&row.period>=lastYear)
    .sort((a,b)=>b.period.localeCompare(a.period));
  const complete=recent.filter(row=>costColumns.every(([key])=>row.costs[key]!==null));
  const basis=(complete.length?complete:recent).slice(0,3);
  const mean=(values:(number|null)[])=>values.length&&values.every(value=>value!==null)?Math.round(sum(values)/values.length):null;
  const average=emptyCosts();
  for(const [key] of costColumns)average[key]=mean(basis.map(row=>row.costs[key]));
  const averageEquipment=mean(basis.map(row=>row.equipment));
  const averageTotal=mean(basis.map(row=>row.total));
  const months=Array.from({length:12},(_,index):CostMonth=>{
    const period=year+'-'+String(index+1).padStart(2,'0');
    const actual=observed.get(period);
    if(actual)return actual;
    if(period<currentMonth||averageTotal===null)return {
      period,costs:emptyCosts(),
      equipment:null,total:null,source:'Offen',kind:'missing',
    };
    const subs=adjustForWinterClosure(period,average.subs);
    const costs={...average,subs};
    const total=average.subs===null?averageTotal:sum([averageTotal,subs])-average.subs;
    const all=costColumns.map(([key])=>costs[key]);
    if(costs.other!==null&&all.every(value=>value!==null))costs.other+=total-sum(all);
    return {period,costs,equipment:averageEquipment,total,source:'Prognose',kind:'forecast'};
  });

  function totals(kind:CostMonth['kind']){
    const rows=months.filter(row=>row.kind===kind);
    const costs={...average};
    for(const [key] of costColumns)costs[key]=rows.length&&rows.every(row=>row.costs[key]!==null)?sum(rows.map(row=>row.costs[key])):null;
    return {costs,total:anySum(rows.map(row=>row.total))};
  }
  return {months,actual:totals('actual'),forecast:totals('forecast'),basis:basis.map(row=>row.period)};
}
