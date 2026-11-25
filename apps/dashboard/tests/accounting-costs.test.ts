import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingCosts, otherYearCosts } from '../src/calc/accounting-costs.ts';
import type { AccountingReport, SusaRow } from '../src/calc/accounting-pdf.ts';

const account=(number:string,debit:number,credit=0):SusaRow=>({
  account:number,label:number,opening:90000,balance:90000,debit,credit,ytdDebit:debit,ytdCredit:credit,
});

test('Kosten kombinieren BWA und SuSa ohne Doppelzählung und erhalten Gutschriften',()=>{
  const bwa:AccountingReport={kind:'bwa',period:'2026-10',revenue:100000,operating:0,beforeTax:0,result:0,rows:[
    {label:'Personalkosten',month:20000,ytd:null,prior:null},
    {label:'Raumkosten',month:3000,ytd:null,prior:null},
    {label:'Fahrzeugko. (o. St.)',month:2000,ytd:null,prior:null},
    {label:'Betriebl. Steuern',month:500,ytd:null,prior:null},
    {label:'Versich./Beiträge',month:1000,ytd:null,prior:null},
    {label:'Mat./Wareneinkauf',month:10000,ytd:null,prior:null},
    {label:'Gesamtkosten',month:30000,ytd:null,prior:null},
  ]};
  const susa:AccountingReport={kind:'susa',period:bwa.period,rows:[
    account('1200',100000),account('2200',5000),account('4100',24000),account('3120',10000),
    account('3151',0,500),account('4510',500),account('4832',200),account('4930',300),account('4985',900,100),
  ]};
  const result=accountingCosts([bwa,susa],'2026','2026-11');
  const october=result.months[9];
  assert.equal(october.total,40000);
  assert.deepEqual(october.costs,{staff:20000,subs:9500,vehicles:2700,office:3300,general:1000,other:3500});
  assert.equal(october.equipment,800);
  assert.equal(otherYearCosts(october),3700);
  assert.equal(result.months[8].kind,'missing');
  assert.equal(result.months[10].total,40000);
  assert.equal(result.months[10].equipment,800);
  assert.equal(result.months[11].costs.subs,6045);
  assert.equal(result.months[11].total,36545);
});

test('Kosten leiten den Januar aus der Februar-BWA ab und lassen ungeklärte Nachunternehmer offen',()=>{
  const bwa:AccountingReport={kind:'bwa',period:'2026-02',revenue:100000,operating:0,beforeTax:0,result:0,rows:[
    {label:'Personalkosten',month:20000,ytd:30000,prior:null},
    {label:'Wareneinsatz',month:10000,ytd:15000,prior:null},
    {label:'Gesamtkosten',month:30000,ytd:50000,prior:null},
  ]};
  const result=accountingCosts([bwa],'2026','2026-11');
  assert.equal(result.months[0].total,25000);
  assert.equal(result.months[0].costs.staff,10000);
  assert.equal(result.months[0].costs.subs,null);
  assert.equal(result.months[0].equipment,null);
  assert.equal(result.months[10].costs.subs,null);
});
