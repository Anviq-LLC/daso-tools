import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustForWinterClosure, isWinterClosure } from '../src/calc/forecast.ts';

test('winter closure covers two ISO weeks from KW 52, also across New Year', () => {
  // 2025: KW 52 starts 22.12., second week is KW 1 of 2026
  assert.equal(isWinterClosure('2025-12-21'), false);
  assert.equal(isWinterClosure('2025-12-22'), true);
  assert.equal(isWinterClosure('2026-01-04'), true);
  assert.equal(isWinterClosure('2026-01-05'), false);
  // 2026 has a KW 53: closure runs 21.12. to 3.1.
  assert.equal(isWinterClosure('2026-12-21'), true);
  assert.equal(isWinterClosure('2027-01-03'), true);
  assert.equal(isWinterClosure('2027-01-04'), false);
});

test('December and January estimates shrink by the closed working days', () => {
  assert.equal(adjustForWinterClosure('2026-06', 1_000_000), 1_000_000);
  const dec = adjustForWinterClosure('2026-12', 1_000_000)!;
  assert.ok(dec < 1_000_000 && dec > 0);
  assert.equal(adjustForWinterClosure('2026-12', null), null);
});
