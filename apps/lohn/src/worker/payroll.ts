import type { AnnualAllowances } from '../calc/payroll.ts';
import type { Env } from './auth.ts';
import type { Employee } from './sources.ts';

export function payrollInputChange(
  env: Env, month: string, resourceId: string, patch: Record<string, string | number | null>, requireLocalEmployee = false,
) {
  const data = JSON.stringify(patch);
  const localId = requireLocalEmployee ? resourceId : null;
  return env.DB.prepare(`INSERT INTO payroll_inputs (month, resource_id, data)
    SELECT ?, ?, json_patch('{}', ?)
    WHERE ? IS NULL OR EXISTS (SELECT 1 FROM payroll_employees WHERE id = ?)
    ON CONFLICT(month, resource_id) DO UPDATE SET data = json_patch(payroll_inputs.data, ?)`)
    .bind(month, resourceId, data, localId, localId, data);
}

export async function manualPayrollEmployees(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, name, name_key, role, from_month, removed_from_month FROM payroll_employees ORDER BY name_key')
    .all<Employee & { name_key: string; from_month: string; removed_from_month: string | null }>();
  return results;
}

export function activePayrollEmployee(person: { from_month: string; removed_from_month: string | null }, month: string) {
  return person.from_month <= month && (person.removed_from_month === null || month < person.removed_from_month);
}

export async function annualAllowances(env: Env, year: string) {
  const { results } = await env.DB.prepare(`
    WITH manual AS (
      SELECT month, resource_id, json_extract(data, '$.notfall') AS notfall,
        json_extract(data, '$.werkzeugGeld') AS werkzeugGeld
      FROM payroll_inputs
      WHERE month BETWEEN ?1 AND ?2 AND resource_id <> '_notes'
    ), payments AS (
      SELECT resource_id, COALESCE(notfall, 0) AS notfall, COALESCE(werkzeugGeld, 0) AS werkzeugGeld
      FROM manual
      UNION ALL
      SELECT a.resource_id, a.cents, 0
      FROM adjustments AS a
      LEFT JOIN manual ON manual.month = a.month AND manual.resource_id = a.resource_id
      WHERE a.month BETWEEN ?1 AND ?2 AND a.kind = 'notfall' AND manual.notfall IS NULL
    )
    SELECT resource_id, SUM(notfall) AS notfall, SUM(werkzeugGeld) AS werkzeugGeld
    FROM payments GROUP BY resource_id`
  ).bind(year + '-01', year + '-12').all<AnnualAllowances & { resource_id: string }>();
  return Object.fromEntries(results.map(({ resource_id, ...amounts }) => [resource_id, amounts]));
}
