import type { AccountingReport } from './accounting-pdf.ts';

export type AccountingMonth={
  period:string;source:'BWA'|'BWA · abgeleitet';revenue:number|null;
  operating:number|null;beforeTax:number|null;sourcePeriod:string;
  revenueYtd?:number|null;beforeTaxYtd?:number|null;
};

export function yearRevenue(book:AccountingMonth|undefined,liveRevenue:number|null){
  if(book?.revenue!=null)return {revenue:book.revenue,source:book.source,useBwa:true};
  return {revenue:liveRevenue,source:liveRevenue!==null?'Aufmaß':'Offen',useBwa:false};
}

export function accountingMonths(reports:AccountingReport[]){
  const months=new Map<string,AccountingMonth>();
  const bwas=reports.filter(report=>report.kind==='bwa');
  for(const report of bwas){
    const cumulative=(label:RegExp)=>report.rows.find(row=>label.test(row.label.trim().replace(/\s+/g,' ')))?.ytd??null;
    months.set(report.period,{period:report.period,source:'BWA',sourcePeriod:report.period,
      revenue:report.revenue,operating:report.operating,beforeTax:report.beforeTax,
      revenueYtd:cumulative(/^Umsatzerlöse$/i),beforeTaxYtd:cumulative(/^Ergebnis vor Steuern$/i)});
  }
  for(const report of bwas){
    if(!report.period.endsWith('-02'))continue;
    const january=report.period.slice(0,4)+'-01';
    const existing=months.get(january);
    function difference(label:RegExp){
      const row=report.rows.find(row=>label.test(row.label)&&row.ytd!==null&&row.month!==null);
      return row?.ytd!=null&&row.month!=null?row.ytd-row.month:null;
    }
    const revenue=existing?.revenue??difference(/^Umsatzerlöse$/i);
    const operating=existing?.operating??difference(/^Betriebsergebnis$/i);
    const beforeTax=existing?.beforeTax??difference(/^Ergebnis vor Steuern$/i);
    if(existing)continue;
    if([revenue,operating,beforeTax].every(value=>value===null))continue;
    months.set(january,{period:january,source:'BWA · abgeleitet',sourcePeriod:report.period,revenue,operating,beforeTax});
  }
  return months;
}
