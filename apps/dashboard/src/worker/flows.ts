// Figures the Dashboard receives from other tools, shown next to its own estimates. Nothing here changes those estimates.
import { readOnly, type Env } from './auth.ts';

export type Flows = {
  month: string;
  payroll: { status: string; grossCents: number | null; employees: number } | null;
  nu: { reviewedCents: number; invoices: number; byCompany: { name: string; cents: number }[] } | null;
};

const RELEASED = ['freigegeben', 'abgeschlossen'];

// Gross pay of staff as the Lohntool released it. Open months have no final figure yet.
async function payroll(env: Env, month: string): Promise<Flows['payroll']> {
  if (!env.LOHN_DB) return null;
  try {
    const row = await readOnly(env.LOHN_DB).prepare('SELECT status, snapshot FROM months WHERE month = ?').bind(month).first<{ status: string; snapshot: string | null }>();
    if (!row) return { status: 'offen', grossCents: null, employees: 0 };
    if (!RELEASED.includes(row.status) || !row.snapshot) return { status: row.status, grossCents: null, employees: 0 };
    const rows = (JSON.parse(row.snapshot).result?.rows ?? []) as { sub?: boolean; paySummary?: { actual?: { gross?: number } } }[];
    const staff = rows.filter((r) => !r.sub && typeof r.paySummary?.actual?.gross === 'number');
    return { status: row.status, grossCents: staff.reduce((n, r) => n + r.paySummary!.actual!.gross!, 0), employees: staff.length };
  } catch {
    return null;
  }
}

// Invoices the Nachunternehmer tool has reviewed, counted in the month of payment, or of review when no date is set.
async function nuReviewed(env: Env, month: string): Promise<Flows['nu']> {
  if (!env.NU_DB) return null;
  try {
    const row = await readOnly(env.NU_DB).prepare("SELECT data FROM state WHERE id = 'main'").first<{ data: string }>();
    if (!row) return null;
    const state = JSON.parse(row.data) as { companies?: { id: string; name: string }[]; invoiceReviews?: Record<string, { companyId?: string; reviewed?: boolean; netCents?: number; paymentDate?: string; reviewedDate?: string }> };
    const names = new Map((state.companies ?? []).map((c) => [c.id, c.name]));
    const mine = Object.values(state.invoiceReviews ?? {}).filter((r) => r.reviewed && Number.isSafeInteger(r.netCents) && (r.paymentDate || r.reviewedDate || '').startsWith(month));
    const byCompany = new Map<string, number>();
    for (const r of mine) byCompany.set(names.get(r.companyId ?? '') ?? 'Unbekannt', (byCompany.get(names.get(r.companyId ?? '') ?? 'Unbekannt') ?? 0) + r.netCents!);
    return {
      reviewedCents: mine.reduce((n, r) => n + r.netCents!, 0),
      invoices: mine.length,
      byCompany: [...byCompany].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
    };
  } catch {
    return null;
  }
}

export async function flows(env: Env, month: string): Promise<Flows> {
  const [p, n] = await Promise.all([payroll(env, month), nuReviewed(env, month)]);
  return { month, payroll: p, nu: n };
}
