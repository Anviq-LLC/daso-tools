import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressiveBonus, saturdayBonus, hoursPay, nuProjectBonus, toolInstallment } from '../src/calc/bonus.ts';

const eur = (n: number) => Math.round(n * 100);

test('progressive bonus', () => {
  assert.equal(progressiveBonus(eur(8000)), 0);
  assert.equal(progressiveBonus(eur(10000)), eur(400));
  assert.equal(progressiveBonus(eur(12000)), eur(900));
  assert.equal(progressiveBonus(1_254_753), 109_164);
  assert.equal(progressiveBonus(eur(15000)), eur(1950));
});

test('Samstagsbonus kommt zum Stundenlohn hinzu', () => {
  const pay = hoursPay(8 * 60, eur(20.37));
  assert.equal(pay, 16296);
  assert.equal(saturdayBonus(eur(800)), eur(320));
  assert.equal(pay + saturdayBonus(eur(100)), eur(202.96));
});

test('nu project bonus', () => {
  const r = nuProjectBonus({ nuRevenue: eur(60000), nuCost: eur(40000), foremanMinutes: 100 * 60, foremanCostPerHour: eur(50) });
  assert.deepEqual(r, { profit: eur(15000), bonus: eur(1500) });
  assert.equal(nuProjectBonus({ nuRevenue: 0, nuCost: 100, foremanMinutes: 0, foremanCostPerHour: 0 }).bonus, 0);
});

test('tool account', () => {
  assert.equal(toolInstallment(eur(2500), eur(2000), 0, eur(100)).debt, eur(500));
  assert.equal(toolInstallment(eur(2500), eur(2000), eur(450), eur(100)).installment, eur(50));
  assert.equal(toolInstallment(eur(2500), eur(2000), eur(500), eur(100)).installment, 0);
});
