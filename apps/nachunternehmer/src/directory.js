// Master data other DaSo tools may read. No documents, ratings or ID data.
export function directory(s) {
  const archived = (x) => !!(x.archived || x.inactive);
  return {
    companies: (s.companies || []).map((c) => ({ id: c.id, name: c.name, archived: archived(c) })),
    teams: (s.teams || []).map((t) => ({ id: t.id, companyId: t.companyId, name: t.name })),
    workers: (s.workers || []).map((w) => ({ id: w.id, companyId: w.companyId, teamId: w.teamId ?? null, name: w.name ?? '', role: w.role ?? '', archived: archived(w) })),
    agreements: (s.projectAgreements || []).map((a) => ({ id: a.id, companyId: a.companyId, projectId: a.projectId ?? null, project: a.project, allProjects: !!a.allProjects, fitterRateCents: a.fitterRateCents ?? null, foremanRateCents: a.foremanRateCents ?? null })),
  };
}
