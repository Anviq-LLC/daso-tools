import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewDays,overviewRevenue,overviewRevenueForecast } from '../src/calc/overview.ts';
import type { EmpFact,SubFact } from '../src/calc/extract.ts';

test('Übersicht hält die Personentage und Pro-Kopf-Umsätze beider Gruppen auseinander',()=>{
  const day='2026-11-19';
  const own:EmpFact={day,resourceId:'e1',name:'A',code:'A',projectId:'p',label:'P',reportId:'r',
    customer:100000,employee:90000,binding:true,estimated:false};
  const sub:SubFact={day,projectId:'p',label:'P',firm:'NU',team:'A',reportId:'s',
    customer:120000,cost:70000,heads:3,minutes:null,binding:true,estimated:false};
  const staff=[{id:'e2',name:'B',code:'B',days:[{day,minutes:420,revenue:0,hasRevenue:false,absence:null}]}];
  const [row]=overviewDays(staff,[own],[sub,{...sub,customer:30000}], [{target:50000,dates:[day]}],new Map());
  assert.deepEqual([row.ownHeads,row.subHeads,row.ownPerHead,row.subPerHead,row.target],[2,3,50000,50000,50000]);
  assert.equal(overviewRevenue([row]).total,250000);
  assert.equal(overviewRevenue([row]).totalPerHead,50000);
  const [incomplete]=overviewDays(staff,[own],[sub,{...sub,team:'B',heads:null}],[{target:50000,dates:[day]}],new Map());
  assert.equal(incomplete.subPerHead,null);
  assert.equal(incomplete.ownPerHead,50000);
  assert.equal(overviewRevenue([incomplete]).totalPerHead,null);
});

test('Monteure und Obermonteure werden nach tatsächlich erfassten Personentagen getrennt gewichtet',()=>{
  const day='2026-11-18',next='2026-11-19';
  const own:EmpFact={day,resourceId:'m',name:'M',code:'M',projectId:'p',label:'P',reportId:'r',
    customer:80000,employee:72000,binding:true,estimated:false};
  const staff=[{id:'m',name:'M',code:'M',days:[{day:next,minutes:480,revenue:0,hasRevenue:false,absence:null}]}];
  const days=overviewDays(staff,[own,
    {...own,reportId:'r2',customer:20000},
    {...own,resourceId:'om',customer:180000},
    {...own,resourceId:'unlinked',customer:60000},
  ],[],[{target:50000,dates:[day,next]}],new Map([['m',' Monteur '],['om','OBERMONTEUR']]));
  const totals=overviewRevenue(days);
  assert.deepEqual([totals.mPerHead,totals.omPerHead,totals.own],[50000,180000,340000]);
  assert.deepEqual([days[0].ownRoles.m.revenue,days[0].ownRoles.om.revenue,days[0].total],[100000,180000,340000]);
  assert.equal(overviewRevenue([days[1]]).omPerHead,null);
});

test('Umsatzprognosen je Gruppe ergeben zusammen genau die Gesamtprognose',()=>{
  assert.deepEqual(overviewRevenueForecast(250001,{own:60000,sub:40000}),{total:250001,own:150001,sub:100000});
  assert.deepEqual(overviewRevenueForecast(150000,{own:80000,sub:-10000}),{total:150000,own:160000,sub:-10000});
  assert.deepEqual(overviewRevenueForecast(250000,{own:0,sub:0}),{total:250000,own:null,sub:null});
  assert.deepEqual(overviewRevenueForecast(null,{own:60000,sub:40000}),{total:null,own:null,sub:null});
});
