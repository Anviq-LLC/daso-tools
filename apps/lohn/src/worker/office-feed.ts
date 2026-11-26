import { isOfficeRole, type Assignment, type Punch } from '../import/plan.ts';
import { readOnly } from './auth.ts';

const ABSENCE = ['vacation', 'unpaid', 'sick', 'homeoffice'];

// Office staff stamp and record absences in the Mitarbeiter tool. They reach payroll in the same row shapes the
// Montageplanung uses. A missing binding or missing tables means no office data, never an error.
export async function officeRows(
  ma: D1Database | undefined, people: { id: string; role: string }[], days: { from: string; to: string }, punchRange?: { from: string; to: string },
): Promise<{ assignments: Assignment[]; punches: Punch[] }> {
  const ids = new Set(people.filter((p) => isOfficeRole(p.role)).map((p) => p.id));
  const none = { assignments: [], punches: [] };
  if (!ma || !ids.size) return none;
  try {
    const db = readOnly(ma);
    const [absences, punches] = await Promise.all([
      db.prepare('SELECT employee_id, day, type FROM absences WHERE day >= ? AND day <= ?').bind(days.from, days.to).all<{ employee_id: string; day: string; type: string }>(),
      punchRange
        ? db.prepare('SELECT employee_id, started, ended, pause FROM punches WHERE ended IS NOT NULL AND started >= ? AND started <= ?').bind(punchRange.from, punchRange.to).all<{ employee_id: string; started: string; ended: string; pause: number | null }>()
        : Promise.resolve({ results: [] as { employee_id: string; started: string; ended: string; pause: number | null }[] }),
    ]);
    return {
      assignments: absences.results.filter((a) => ids.has(a.employee_id) && ABSENCE.includes(a.type)).map((a) => ({ resource_id: a.employee_id, project_id: null, day: a.day, assignment_type: a.type })),
      punches: punches.results.filter((p) => ids.has(p.employee_id)).map((p) => ({ resource_id: p.employee_id, project_id: null, started: p.started, ended: p.ended, pause: p.pause })),
    };
  } catch {
    return none;
  }
}
