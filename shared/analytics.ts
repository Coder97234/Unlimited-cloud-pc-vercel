export const ACTIVE_MINUTES = 2;
export const RETENTION_DAYS = 90;
export const REPORT_DAYS = 30;
export type AnalyticsReport = {
  active: number; today: number; browsers: number; returning: number; accounts: number;
  days: { date: string; browsers: number }[]; updatedAt: string;
};
