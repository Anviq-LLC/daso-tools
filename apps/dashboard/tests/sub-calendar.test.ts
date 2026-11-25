import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, parseRecords, type SubFact } from '../src/calc/extract.ts';
import { subCalendarDays, subCalendarFirms, subCalendarWeeks } from '../src/calc/sub-calendar.ts';

test('Subs berechnet gemeinsame Durchschnittswerte je Personentag für Firmen, Wochen und Projekte',()=>{
  const base:SubFact={firm:'Alpha',team:'A',projectId:'p',label:'Halle',day:'2026-11-02',reportId:'r',
    customer:80000,cost:30000,heads:2,minutes:null,binding:true,estimated:false,basis:'performance'};
  const days=subCalendarDays([
    base,{...base,customer:20000,cost:0},
    {...base,basis:'hourly',customer:50000,cost:20000,heads:1},
    {...base,projectId:'q',label:'Büro',day:'2026-11-03',customer:30000,cost:null,heads:1},
    {...base,firm:'Beta',customer:90000,cost:70000},
    {...base,day:'2025-12-31'},{...base,binding:false},
  ],'2026');
  const [alpha,beta]=subCalendarFirms(days);
  assert.equal(alpha.revenue,180000);
  assert.equal(alpha.personDays,3);
  assert.equal(alpha.cost,null);
  assert.equal(alpha.profit,null);
  assert.equal(alpha.averageRevenue,60000);
  assert.equal(alpha.averageCost,null);
  assert.equal(alpha.averageProfit,null);
  assert.equal(beta.cost,70000);
  assert.deepEqual([beta.averageRevenue,beta.averageCost,beta.averageProfit],[45000,35000,10000]);
  const [week]=subCalendarWeeks(alpha.rows);
  assert.equal(week.week,'2026-11-02');
  assert.deepEqual(week.byProject.map(project=>[project.id,project.revenue,project.cost,project.profit]),[
    ['q',30000,null,null],['p',150000,50000,100000],
  ]);
  assert.equal(week.averageRevenue,60000);
  assert.deepEqual(week.byProject.map(project=>[project.averageRevenue,project.averageCost,project.averageProfit]),[
    [30000,null,null],[75000,25000,50000],
  ]);
});

test('Eigenständige Stundenzettel und verknüpfter Mehraufwand bleiben getrennt',()=>{
  const day='2026-11-02';
  const project={id:'p',name:'Halle',number:'42',factor:0.9};
  const worker={id:'e',date:day,workerId:'sub:A:0',code:'AA',name:'A',role:'fitter',start:'08:00',end:'16:00',pauseMinutes:0,
    travelQuantity:0,overnightQuantity:0,rates:{billingHourly:5000,costHourly:2500,travelCost:0,overnightCost:0}};
  const report={projectId:project.id,date:day,endDate:day,lines:[],state:'ready',team:'A',
    teamWork:{code:'A',company:'Alpha',hourlyRate:2500,workers:[{name:'A',hours:null},{name:'B',hours:null}]},
    timeSheet:{mode:'day',anchorDate:day,factor:0.9,entries:[worker]}};
  const record=<T extends {id:string}>(kind:string,row:T)=>({kind,id:row.id,data:JSON.stringify(row)});
  const data=parseRecords([
    record('project',project),
    record('report',{...report,id:'standalone',kind:'timesheet'}),
    record('report',{...report,id:'extra',kind:'extra',parentReportId:'parent'}),
  ]);
  const rows=extract(data,null).sub;
  assert.deepEqual(rows.map(row=>[row.basis,row.heads,row.minutes,row.customer,row.cost]),[
    ['hourly',1,480,40000,20000],['performance',1,480,40000,0],
  ]);
});
