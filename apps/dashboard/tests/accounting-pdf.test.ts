import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountingPdf } from '../src/calc/accounting-pdf.ts';
import { bwaDraft, correctedBwa } from '../src/calc/accounting-edit.ts';
import { accountingMonths, yearRevenue, type AccountingMonth } from '../src/calc/accounting-history.ts';
import { dashboardYear } from '../src/calc/dashboard-year.ts';
import type { AccountingReport } from '../src/calc/accounting-pdf.ts';

test('BWA liest getrennte Minuszeichen und mehrteilige Ergebnisbezeichnungen',()=>{
  const cell=(str:string,x:number,y:number,width:number)=>({str,transform:[1,0,0,1,x,y],width});
  const report=parseAccountingPdf([[
    cell('Kurzfristige Erfolgsrechnung Oktober 2026',10,80,175),
    cell('Bezeichnung',10,70,60),cell('Okt 2026',260,70,40),cell('in %',315,70,20),
    cell('Umsatzerlöse',10,60,60),cell('100,00',270,60,30),
    cell('Betriebsergebnis',10,50,80),cell('−',263,50,5),cell('21,50',270,50,30),
    cell('Ergebnis',10,40,38),cell('vor Steuern',50,40,52),cell('11,25',270,40,26),cell('-',296,40,4),
  ]]);
  assert.equal(report.kind,'bwa');
  assert.equal(report.operating,-2150);
  assert.equal(report.beforeTax,-1125);
});

test('Jahresumsatz verwendet den BWA-Monatswert vor dem Aufmaß',()=>{
  const bwa:AccountingMonth={period:'2026-02',source:'BWA',sourcePeriod:'2026-02',revenue:125000,operating:null,beforeTax:null};
  assert.deepEqual(yearRevenue(bwa,180000),{revenue:125000,source:'BWA',useBwa:true});
  assert.deepEqual(yearRevenue({...bwa,revenue:0},180000),{revenue:0,source:'BWA',useBwa:true});
  assert.deepEqual(yearRevenue({...bwa,revenue:null},180000),{revenue:180000,source:'Aufmaß',useBwa:false});
  assert.deepEqual(yearRevenue(undefined,null),{revenue:null,source:'Offen',useBwa:false});
});

test('Jahresvorschau nutzt die gewählten Ist-Quellen, den BWA-Jahreswert und die Steuerschätzung',()=>{
  const october:AccountingMonth={period:'2026-10',source:'BWA',sourcePeriod:'2026-10',revenue:200_000,
    operating:null,beforeTax:-10_000,revenueYtd:1_000_000,beforeTaxYtd:120_000};
  const months=[
    {month:'2026-09',revenue:null,revenueThrough:null},
    {month:'2026-10',revenueThrough:'2026-10-31',book:october,...yearRevenue(october,500_000)},
    {month:'2026-11',revenue:100_000,revenueThrough:'2026-11-17'},
    {month:'2026-12',revenue:null,revenueThrough:null},
  ];
  const result=dashboardYear(months,'2026-11-19',160_000);
  assert.equal(result.total,300_000);
  assert.equal(result.revenueThrough,'2026-11-17');
  assert.equal(result.yearForecast,474_545);
  assert.equal(result.points.find(row=>row.month==='2026-12')?.revenue,114_545);
  assert.equal(result.points[0].revenue,null);
  assert.equal(result.profit,120_000);
  assert.equal(result.estimatedTax,36_000);
  assert.equal(result.currentProfit,19_200);

  const november={...october,period:'2026-11',sourcePeriod:'2026-11',revenue:50_000,beforeTax:-130_000,beforeTaxYtd:null};
  const withNovember=dashboardYear([months[1],{...months[2],book:november,...yearRevenue(november,100_000)},months[3]],'2026-11-19',160_000);
  assert.equal(withNovember.currentForecast,50_000);
  assert.equal(withNovember.currentProfit,-130_000);
  assert.equal(withNovember.profit,-10_000);
  assert.equal(withNovember.estimatedTax,0);
});

test('BWA-Korrekturen übernehmen Dezimalbeträge in Monatswerte und Januar-Ableitung',()=>{
  const report:Extract<AccountingReport,{kind:'bwa'}>={kind:'bwa',period:'2026-02',rows:[
    {label:'Umsatzerlöse',month:200000,ytd:330000,prior:120000},
    {label:'Betriebsergebnis',month:30000,ytd:10000,prior:null},
    {label:'Ergebnis vor Steuern',month:null,ytd:null,prior:null},
  ],revenue:200000,operating:30000,beforeTax:null,result:null};
  const draft=bwaDraft(report.rows);
  draft[0]={month:'1.950,50',ytd:'3.250,50',prior:'0'};
  draft[1].month='−50,25';
  draft[2].month='-50,5';
  const corrected=correctedBwa(report,draft);

  assert.equal(report.revenue,200000);
  assert.equal(corrected.revenue,195050);
  assert.equal(corrected.operating,-5025);
  assert.equal(corrected.beforeTax,-5050);
  assert.equal(corrected.rows[0].prior,0);
  assert.equal(accountingMonths([corrected]).get('2026-01')?.revenue,130000);
  draft[0].month='12.50';
  assert.throws(()=>correctedBwa(report,draft),/Umsatzerlöse.*Monat/);
});
