// All money is integer cents. Rates are whole percent.
export type Tier = { from: number; rate: number };

export const STANDARD_TIERS: Tier[] = [
  { from: 800_000, rate: 20 },
  { from: 1_000_000, rate: 25 },
  { from: 1_200_000, rate: 35 },
  { from: 1_400_000, rate: 35 },
];

// Each tier pays its rate only on the revenue that falls inside it.
export function progressiveBonusTiers(revenue: number, tiers: Tier[] = STANDARD_TIERS) {
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  return sorted.map((tier, index) => {
    const to = sorted[index + 1]?.from ?? null;
    const eligible = Math.max(0, Math.min(revenue, to ?? revenue) - tier.from);
    return { ...tier, to, eligible, cents: Math.round((eligible * tier.rate) / 100) };
  });
}

export function progressiveBonus(revenue: number, tiers: Tier[] = STANDARD_TIERS): number {
  return progressiveBonusTiers(revenue, tiers).reduce((sum, tier) => sum + tier.cents, 0);
}

// The Saturday share is paid in addition to the wages for the hours worked.
export const saturdayBonus = (revenue: number, rate = 40) =>
  Math.max(0, Math.round((revenue * rate) / 100));

export const hoursPay = (minutes: number, centsPerHour: number) =>
  Math.round((minutes * centsPerHour) / 60);

export function nuProjectBonus(p: {
  nuRevenue: number;
  nuCost: number;
  foremanMinutes: number;
  foremanCostPerHour: number;
  otherCost?: number;
}) {
  const profit =
    p.nuRevenue - p.nuCost - hoursPay(p.foremanMinutes, p.foremanCostPerHour) - (p.otherCost ?? 0);
  return { profit, bonus: Math.round(Math.max(0, profit) * 0.1) };
}

// Installment never exceeds the remaining debt; prepayments outside payroll only reduce debt.
export function toolInstallment(price: number, paidBefore: number, booked: number, monthlyRate: number) {
  const debt = Math.max(0, price - paidBefore - booked);
  return { debt, installment: Math.min(monthlyRate, debt) };
}
