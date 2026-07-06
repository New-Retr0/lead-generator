import type { CostBudget, CostDayRow, ProviderBalance } from "./types";

/** Firecrawl Standard plan — $99 / 100k credits (matches config/pricing.yaml). */
export const FIRECRAWL_CREDIT_USD = 0.00099;

export const FIRECRAWL_PLAN_CREDITS = 100_000;

function parseBillingPeriodEnd(snapshotJson: unknown): string | null {
  if (snapshotJson == null) return null;
  let payload: Record<string, unknown> | null = null;
  if (typeof snapshotJson === "object" && !Array.isArray(snapshotJson)) {
    payload = snapshotJson as Record<string, unknown>;
  } else if (typeof snapshotJson === "string") {
    try {
      const parsed = JSON.parse(snapshotJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (!payload) return null;
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : payload;
  const raw = data.billingPeriodEnd ?? data.billing_period_end;
  return raw != null ? String(raw) : null;
}

export function buildCostBudget(
  firecrawlBalance: ProviderBalance | undefined,
  byDay: CostDayRow[],
  snapshotJson?: unknown,
): CostBudget | null {
  const plan = firecrawlBalance?.plan ?? FIRECRAWL_PLAN_CREDITS;
  if (plan == null || plan <= 0) return null;

  const remaining = firecrawlBalance?.remaining ?? null;
  const usedThisCycle =
    firecrawlBalance?.used ??
    (remaining != null ? Math.max(plan - remaining, 0) : null);

  const billingPeriodEnd =
    parseBillingPeriodEnd(snapshotJson) ?? firecrawlBalance?.billingPeriodEnd ?? null;

  const recentDays = byDay.slice(-7);
  const recentCredits = recentDays.reduce((sum, row) => sum + row.firecrawlCredits, 0);
  const dailyAverageCredits =
    recentDays.length > 0 ? recentCredits / recentDays.length : null;

  let projectedCycleCredits: number | null = null;
  let projectedOverPlan = false;

  if (usedThisCycle != null && dailyAverageCredits != null && billingPeriodEnd) {
    const end = new Date(billingPeriodEnd);
    const now = new Date();
    const msLeft = end.getTime() - now.getTime();
    const daysLeft = Math.max(msLeft / (24 * 60 * 60 * 1000), 0);
    projectedCycleCredits = usedThisCycle + dailyAverageCredits * daysLeft;
    projectedOverPlan = projectedCycleCredits > plan;
  }

  const percentOfPlanUsed =
    usedThisCycle != null && plan > 0 ? (usedThisCycle / plan) * 100 : null;

  return {
    planCredits: plan,
    remainingCredits: remaining,
    usedThisCycle,
    billingPeriodEnd,
    dailyAverageCredits,
    projectedCycleCredits,
    projectedOverPlan,
    percentOfPlanUsed,
    planTier: "standard",
  };
}
