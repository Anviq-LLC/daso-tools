import { canonicalFirm } from './core.mjs';

const key = (s) => canonicalFirm(String(s ?? '')).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');

// A firm matches a company by its name or by another spelling, so hours booked under an old name keep their firm.
export const companyForFirm = (companies, firm) => {
  const k = key(firm);
  return companies.find((c) => [c.name, ...(c.aliases || [])].some((n) => key(n) === k));
};

export const parseAliases = (text) => [...new Set(String(text || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
