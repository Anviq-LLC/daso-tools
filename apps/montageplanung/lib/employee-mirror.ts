export type MaEmployee = { id: string; name: string; role: string; archived_at: string | null }
export type PlanResource = { id: string; kind: string; name: string; role: string; archived_at: string | null }
export type MirrorStep =
  | { op: 'insert'; id: string; name: string; role: string; archived_at: string | null }
  | { op: 'update'; id: string; name: string; role: string; archived_at: string | null }

// Planning rows follow the Mitarbeiter tool. Missing people are never archived, rows are never deleted,
// contractors are never touched and a planner's own resource is never archived (that would lock them out).
export function employeeMirror(resources: PlanResource[], employees: MaEmployee[], planerResourceIds: Set<string>, now: string): MirrorStep[] {
  const byId = new Map(resources.map((r) => [r.id, r]))
  const steps: MirrorStep[] = []
  for (const e of employees) {
    const r = byId.get(e.id)
    if (!r) { steps.push({ op: 'insert', id: e.id, name: e.name, role: e.role, archived_at: e.archived_at ? now : null }); continue }
    if (r.kind !== 'employee') continue
    const wantArchived = !!e.archived_at && !planerResourceIds.has(e.id)
    const archived_at = wantArchived ? r.archived_at ?? now : null
    if (r.name !== e.name || r.role !== e.role || archived_at !== r.archived_at) steps.push({ op: 'update', id: e.id, name: e.name, role: e.role, archived_at })
  }
  return steps
}
