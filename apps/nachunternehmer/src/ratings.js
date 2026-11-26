import { normalizeAssessment } from '../dist/assessment.mjs';

// Ratings live in their own row, so rating a worker never invalidates anyone's open copy of the main state.
// A stored rating wins over the copy that is still inside the main state.
export function withRatings(state, ratings) {
  if (!state) return state;
  return { ...state, workers: (state.workers || []).map((w) => (ratings[w.id] ? { ...w, assessment: ratings[w.id].assessment } : w)) };
}

// What an Obermonteur gets: names, companies, teams and ratings. No rates, documents or ID data.
export function ratingsView(state) {
  const s = state || {};
  return {
    companies: (s.companies || []).map((c) => ({ id: c.id, name: c.name })),
    teams: (s.teams || []).map((t) => ({ id: t.id, companyId: t.companyId, name: t.name })),
    workers: (s.workers || []).map((w) => ({ id: w.id, companyId: w.companyId, teamId: w.teamId ?? null, name: w.name ?? '', role: w.role ?? '', assessment: w.assessment ?? null })),
    docs: [], rows: [], projectAgreements: [], invoices: {}, approvals: {}, adjustments: {}, invoiceReviews: {}, settings: { noticeDays: 14 },
  };
}

export function setRating(ratings, state, id, assessment, email, at) {
  if (!(state.workers || []).some((w) => w.id === id)) throw Error('Mitarbeiter nicht gefunden.');
  return { ...ratings, [id]: { assessment: normalizeAssessment(assessment || {}), by: email, at } };
}
