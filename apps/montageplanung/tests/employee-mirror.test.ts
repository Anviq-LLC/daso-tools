import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeMirror } from '../lib/employee-mirror'

const now = '2026-11-26T10:00:00.000Z'
const res = (id: string, o: object = {}) => ({ id, kind: 'employee', name: 'N' + id, role: 'Monteur', archived_at: null, ...o })
const ma = (id: string, o: object = {}) => ({ id, name: 'N' + id, role: 'Monteur', archived_at: null, ...o })

test('new people are inserted, changed names and roles are updated', () => {
  assert.deepEqual(employeeMirror([res('a')], [ma('a', { name: 'Neu', role: 'Büro' }), ma('b')], new Set(), now), [
    { op: 'update', id: 'a', name: 'Neu', role: 'Büro', archived_at: null },
    { op: 'insert', id: 'b', name: 'Nb', role: 'Monteur', archived_at: null },
  ])
})

test('archiving and restoring follow the tool, but a planner is never archived', () => {
  assert.deepEqual(employeeMirror([res('a'), res('p'), res('r', { archived_at: 'x' })], [ma('a', { archived_at: 'y' }), ma('p', { archived_at: 'y' }), ma('r')], new Set(['p']), now), [
    { op: 'update', id: 'a', name: 'Na', role: 'Monteur', archived_at: now },
    { op: 'update', id: 'r', name: 'Nr', role: 'Monteur', archived_at: null },
  ])
})

test('people missing from the tool and contractors are left alone, and a second run changes nothing', () => {
  const rows = [res('gone'), res('c', { kind: 'contractor' })]
  assert.deepEqual(employeeMirror(rows, [ma('c', { name: 'Anders' })], new Set(), now), [])
  const steps = employeeMirror([res('a')], [ma('a', { name: 'Neu' })], new Set(), now)
  assert.deepEqual(employeeMirror([res('a', { name: 'Neu' })], [ma('a', { name: 'Neu' })], new Set(), now), [])
  assert.equal(steps.length, 1)
})
