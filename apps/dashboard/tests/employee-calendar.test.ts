import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeCalendarRows,employeePeriod } from '../src/calc/employee-calendar.ts';
import type { EmpFact } from '../src/calc/extract.ts';

test('Mitarbeiter-Kalender berechnet echte Tageswerte, bevorzugt manuelle Stunden und zählt Abwesenheiten separat',()=>{
  const fact:EmpFact={day:'2026-10-29',resourceId:'e',name:'A',code:'A',projectId:'p',label:'Projekt',
    reportId:'r',customer:100000,employee:90000,binding:true,estimated:false};
  const punch={day:'2026-11-02',resourceId:'e',projectId:'p',minutes:480,travel:false,open:false};
  const rows=employeeCalendarRows({
    resources:[{id:'e',name:'A',code:'A'}],
    revenue:[fact,{...fact,day:'2026-11-03',customer:90000,employee:81000},
      {...fact,day:'2026-11-01',binding:false},{...fact,day:'2026-11-30'}],
    hours:[punch,{...punch,day:'2026-11-03',minutes:360},{...punch,day:'2026-11-04',travel:true}],
    manual:[{resource_id:'e',day:'2026-11-02',data:'{"workHours":"7,5"}'}],
    assignments:[
      {day:'2026-11-04',resource_id:'e',project_id:null,assignment_type:'vacation'},
      {day:'2026-11-05',resource_id:'e',project_id:null,assignment_type:'unpaid'},
      {day:'2026-11-06',resource_id:'e',project_id:null,assignment_type:'sick'},
    ],from:'2026-01-01',to:'2026-11-19',
  });
  const [november]=employeePeriod(rows,'2026-11');
  assert.equal(november.revenue,81000);
  assert.equal(november.averageRevenue,40500);
  assert.equal(november.minutes,810);
  assert.equal(november.averageMinutes,405);
  assert.deepEqual(november.absences,{vacation:1,unpaid:1,sick:1});
  const [year]=employeePeriod(rows,null);
  assert.equal(year.revenue,171000);
  assert.equal(year.averageRevenue,57000);
  assert.equal(year.averageMinutes,405);
});

