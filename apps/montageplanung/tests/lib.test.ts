import test from 'node:test';
import assert from 'node:assert/strict';
import { workdays } from '../lib/workdays';
import { holiday, meal, capWork, toHm, fromHm, dayInfo } from '../lib/hours';

test('workdays skips weekends and includes both ends', () => {
  assert.deepEqual(workdays('2026-11-06', '2026-11-10'), ['2026-11-06', '2026-11-09', '2026-11-10']);
  assert.deepEqual(workdays('2026-11-07', '2026-11-08'), []);
});

test('holiday knows fixed and Easter-based days of Rheinland-Pfalz', () => {
  assert.equal(holiday('2026-01-01'), 'Neujahr');
  assert.equal(holiday('2026-04-03'), 'Karfreitag');
  assert.equal(holiday('2026-04-06'), 'Ostermontag');
  assert.equal(holiday('2026-05-14'), 'Christi Himmelfahrt');
  assert.equal(holiday('2026-06-04'), 'Fronleichnam');
  assert.equal(holiday('2026-11-01'), 'Allerheiligen');
  assert.equal(holiday('2026-11-09'), '');
});

test('meal allowance by absence hours, none while away on leave', () => {
  assert.equal(meal('project', 7.9), 0);
  assert.equal(meal('project', 8), 14);
  assert.equal(meal('project', 24), 28);
  assert.equal(meal('vacation', 30), 0);
  assert.equal(meal('sick', 30), 0);
});

test('capWork caps at 10 h, 18 h on holidays, unless a note explains it', () => {
  assert.equal(capWork(12, '', ''), '10.00');
  assert.equal(capWork(12, 'Notdienst', ''), 12);
  assert.equal(capWork(10, '', ''), 10);
  assert.equal(capWork(12, '', 'Neujahr'), 12);
  assert.equal(capWork(19, '', 'Neujahr'), '18.00');
});

test('toHm and fromHm convert between decimal hours and h:mm', () => {
  assert.equal(toHm(7.5), '7:30');
  assert.equal(toHm(''), '');
  assert.equal(fromHm('7:30'), '7.50');
  assert.equal(fromHm('7,5'), '7.50');
  assert.equal(fromHm(''), '');
  assert.equal(fromHm('abc'), null);
  assert.equal(fromHm('-1'), null);
  assert.equal(fromHm('7:75'), null);
});

const punch = (project_id: string | null, started: string, ended: string, pause: number | null = null) =>
  ({ resource_id: 'r1', project_id, started, ended, pause });

test('dayInfo sums work time minus pause and measures travel as absence', () => {
  const info = dayInfo(
    [],
    [punch(null, '2026-11-09T06:00:00', '2026-11-09T07:00:00'), punch('p1', '2026-11-09T07:00:00', '2026-11-09T15:30:00', 30)],
    'r1',
    '2026-11-09',
  );
  assert.equal(info.workHours, '8.00');
  assert.equal(info.workStart, '07:00');
  assert.equal(info.workEnd, '15:30');
  assert.equal(info.pause, '30');
  assert.equal(info.travelHours, '1.00');
  assert.equal(info.absence, '9.50');
  assert.equal(info.projectId, 'p1');
});

test('dayInfo books 8 h for a leave day and adds the holiday credit on top of work', () => {
  const leave = dayInfo([{ resource_id: 'r1', project_id: null, day: '2026-11-09', assignment_type: 'vacation' }], [], 'r1', '2026-11-09');
  assert.equal(leave.workHours, '8.00');
  assert.equal(leave.absence, '0');

  const holidayWork = dayInfo([], [punch('p1', '2026-05-14T08:00:00', '2026-05-14T12:00:00')], 'r1', '2026-05-14');
  assert.equal(holidayWork.holiday, 'Christi Himmelfahrt');
  assert.equal(holidayWork.workHours, '12.00');
});

test('dayInfo ignores open punches and other employees', () => {
  const info = dayInfo(
    [],
    [punch('p1', '2026-11-09T07:00:00', null as unknown as string), { ...punch('p1', '2026-11-09T07:00:00', '2026-11-09T15:00:00'), resource_id: 'r2' }],
    'r1',
    '2026-11-09',
  );
  assert.equal(info.workHours, '');
});
