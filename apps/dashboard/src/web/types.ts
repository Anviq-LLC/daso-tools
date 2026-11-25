import type { monthReport, yearReport } from '../worker/data.ts';

export type MonthData = Awaited<ReturnType<typeof monthReport>> & {hasRevenueData?:boolean};
type YearReport = Awaited<ReturnType<typeof yearReport>>;
export type YearData = Omit<YearReport,'months'> & {months:(YearReport['months'][number]&{hasRevenueData?:boolean;revenueThrough?:string|null})[]};
export type Me = { email: string; role: 'gf' | 'buchhaltung' | 'viewer'; sensitive: boolean; today: string };
