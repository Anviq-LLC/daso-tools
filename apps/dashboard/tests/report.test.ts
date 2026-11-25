import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonth, employeeYearRanking, projectYearRanking, type MonthInput } from '../src/calc/report.ts';
import { DEFAULT_TARGET } from '../src/calc/rules.ts';
import { forecastMonth, forecastYear, isWinterClosure } from '../src/calc/forecast.ts';
import { holidaysRP } from '../src/calc/holidays.ts';

const cfg = { target: DEFAULT_TARGET, employerPct: 0, defaultHourly: 0, modelSaturdayBonus: false };
const base = (o: Partial<MonthInput>): MonthInput => ({
  month: '2026-03', emp: [], sub: [], hours: [], absence: [], costTypes: [], entries: [], wages: [],
  resources: [{ id: 'r1', name: 'A', code: 'A', archived: false }], holidays: new Set(), cfg, showPersonnel: true, ...o,
});
const empRow = (day: string, project: string, customer: number, binding = true) =>
  ({ day, resourceId: 'r1', name: 'A', projectId: project, label: project, reportId: 'x' + day, customer, employee: Math.round(customer * 0.9), binding, estimated: false });

test('Mitarbeiter-Ranking verbindet den Vergleichsmonat mit der Rangfolge nach Jahresumsatz',()=>{
  const reports=[
    buildMonth(base({month:'2025-10',emp:[empRow('2025-10-15','p',40000)]})),
    buildMonth(base({month:'2025-11',emp:[empRow('2025-11-04','p',10000),
      {...empRow('2025-11-04','p',30000),resourceId:'r2',name:'B'}]})),
  ];
  const ranking=employeeYearRanking(reports,2025,'2026-11-19');
  assert.equal(ranking.employeeRankingMonth,'2025-11');
  assert.deepEqual(ranking.employees.map(row=>[row.name,row.monthlyReal,row.real]),[
    ['A',9000,45000],['B',27000,27000],
  ]);
});

test('Projektranking zeigt nur echte Jahresgewinne bzw. Jahresverluste mit vollständigen Sub-Kosten',()=>{
  const project=(id:string,revenue:number,cost:number|null)=>({
    day:'2026-03-02',projectId:id,label:id,firm:'NU',team:'A',reportId:id,customer:revenue,
    cost,heads:2,minutes:480,binding:true,estimated:false,
  });
  const march=buildMonth(base({sub:[
    ...Array.from({length:6},(_,index)=>project('gewinn-'+index,2000+index,1000)),
    project('verlust',500,1800),project('ausgeglichen',1000,1000),
    project('unvollständig',9000,null),project('wechsel',1200,1000),
  ]}));
  const april=buildMonth(base({month:'2026-04',sub:[{...project('wechsel',0,400),day:'2026-04-02'}]}));
  const ranking=projectYearRanking([march,april]);
  assert.deepEqual(ranking.projectsTop.map(row=>row.id),['gewinn-5','gewinn-4','gewinn-3','gewinn-2','gewinn-1']);
  assert.deepEqual(ranking.projectsFlop.map(row=>[row.id,row.before]),[['verlust',-1300],['wechsel',-200]]);
  assert.deepEqual(projectYearRanking([buildMonth(base({sub:[project('gewinn',1000,500)]}))]).projectsFlop,[]);
});

test('two excused days give 727,27 fictive credit and no revenue', () => {
  const r = buildMonth(base({ absence: [
    { day: '2026-03-02', resourceId: 'r1', kind: 'vacation', review: false },
    { day: '2026-03-03', resourceId: 'r1', kind: 'sick', review: false },
  ] }));
  assert.equal(r.employees[0].fiction, 72_727);
  assert.equal(r.revenue, 0);
  assert.equal(r.employees[0].real, 0);
});

test('credit is once per person and day, weekends excluded, revenue day goes to review', () => {
  const r = buildMonth(base({
    holidays: new Set(['2026-03-02']),
    absence: [{ day: '2026-03-02', resourceId: 'r1', kind: 'vacation', review: false }, { day: '2026-03-07', resourceId: 'r1', kind: 'sick', review: false }, { day: '2026-03-04', resourceId: 'r1', kind: 'sick', review: false }],
    emp: [empRow('2026-03-04', 'p', 10_000)],
  }));
  assert.equal(r.employees[0].absenceDays, 1);
  assert.deepEqual(r.employees[0].reviewDays, ['2026-03-04']);
});

test('overhead is split by revenue and subtracted once', () => {
  const r = buildMonth(base({
    emp: [empRow('2026-03-10', 'big', 5_000_000), empRow('2026-03-11', 'small', 15_000_000)],
    costTypes: [{ id: 'c', name: 'Buero', category: 'overhead', monthly: 2_000_000, validFrom: '2026-01-01', validTo: null }],
  }));
  assert.equal(r.projects.find((p) => p.id === 'big')!.overhead, 500_000);
  assert.equal(r.projects.reduce((s, p) => s + (p.overhead ?? 0), 0), 2_000_000);
  assert.equal(r.profit, 20_000_000 - 2_000_000);
});

test('no revenue: overhead is not distributed and a warning is shown', () => {
  const r = buildMonth(base({ costTypes: [{ id: 'c', name: 'Kfz', category: 'overhead', monthly: 1_000_000, validFrom: '2026-01-01', validTo: null }], entries: [{ id: 'e', day: '2026-03-03', kind: 'other', projectId: 'p', firm: '', subcategory: '', cents: 100 }] }));
  assert.equal(r.projects[0].overhead, null);
  assert.ok(r.warnings.some((w) => w.includes('Gesamtumsatz 0')));
});

test('hours of two sites add up per person and day', () => {
  const r = buildMonth(base({ hours: [
    { day: '2026-03-02', resourceId: 'r1', projectId: 'A', minutes: 300, travel: false, open: false },
    { day: '2026-03-02', resourceId: 'r1', projectId: 'B', minutes: 240, travel: false, open: false },
  ] }));
  assert.equal(r.employees[0].workMinutes, 540);
});

test('pipeline stays out of binding revenue', () => {
  const r = buildMonth(base({ emp: [empRow('2026-03-10', 'p', 10_000, false)] }));
  assert.equal(r.revenue, 0);
  assert.equal(r.pipeline.total, 10_000);
});

test('without personnel permission no profit or personnel cost is returned', () => {
  const r = buildMonth(base({ showPersonnel: false, emp: [empRow('2026-03-10', 'p', 10_000)] }));
  assert.equal(r.profit, null);
  assert.equal(r.costs.personnel, null);
});

test('forecast projects the average productive weekday, saturdays separately', () => {
  const f = forecastMonth({ month: '2026-03', asOf: '2026-03-13', revenueByDay: { '2026-03-02': 100, '2026-03-03': 300, '2026-03-14': 999 }, holidays: new Set(), saturdayCents: 50 });
  assert.equal(f.ist, 400);
  assert.equal(f.avgWeekday, 200);
  assert.equal(f.remainingWeekdays, 12);
  assert.equal(f.remainingSaturdays, 3);
  assert.equal(f.forecast, 400 + 200 * 12 + 150);
});

test('winter closure covers two ISO weeks starting at KW 52 and preserves booked revenue', () => {
  assert.equal(isWinterClosure('2025-12-22'), true);
  assert.equal(isWinterClosure('2026-01-04'), true);
  assert.equal(isWinterClosure('2026-01-05'), false);
  assert.equal(isWinterClosure('2026-12-20'), false);
  assert.equal(isWinterClosure('2026-12-21'), true);
  assert.equal(isWinterClosure('2027-01-03'), true);
  assert.equal(isWinterClosure('2027-01-04'), false);

  const december = {month:'2026-12', revenueByDay:{'2026-12-01':100,'2026-12-22':300}, holidays:new Set<string>(), saturdayCents:50};
  const before = forecastMonth({...december,asOf:'2026-12-18'});
  assert.equal(before.remainingWeekdays,0);
  assert.equal(before.remainingSaturdays,1);
  assert.equal(before.forecast,150);
  const during = forecastMonth({...december,asOf:'2026-12-22'});
  assert.equal(during.ist,400);
  assert.equal(during.forecast,400);
});

test('year forecast keeps actual and forecast apart', () => {
  const y = forecastYear(2026, '2026-03-10', { '2026-01': 100, '2026-02': 300 }, 500);
  assert.deepEqual(y.points.slice(0, 3).map((p) => p.kind), ['ist', 'ist', 'prognose']);
  assert.equal(y.points[3].kind, 'hochrechnung');
  assert.equal(y.points[3].revenue, 300);
});

test('Rheinland-Pfalz holidays 2026', () => {
  const h = holidaysRP(2026);
  assert.equal(h['2026-04-03'], 'Karfreitag');
  assert.equal(h['2026-05-14'], 'Christi Himmelfahrt');
  assert.equal(h['2026-06-04'], 'Fronleichnam');
  assert.equal(h['2026-11-01'], 'Allerheiligen');
});

test('year forecast mean ignores months without data', () => {
  const y = forecastYear(2026, '2026-03-10', { '2026-02': 300 }, 500, new Set(['2026-02']));
  assert.equal(y.points.find((p) => p.month === '2026-04')!.revenue, 400);
});

test('own and sub head counts and per-head figures are kept apart', () => {
  const r = buildMonth(base({
    emp: [empRow('2026-03-10', 'p', 100_000)],
    sub: [{ day: '2026-03-10', projectId: 'p', label: 'p', firm: 'F', team: 'T', reportId: 's', customer: 400_000, cost: null, heads: 4, minutes: null, binding: true, estimated: false }],
  }));
  const d = r.daily.find((x) => x.day === '2026-03-10')!;
  assert.deepEqual([d.ownHeads, d.subHeads, d.ownPerHead, d.subPerHead], [1, 4, 100_000, 100_000]);
  assert.equal(d.total, 500_000);
});
