import type { CostBudget, CostDayRow, ProviderBalance } from "./types";
import { inferPublicFirecrawlPlan, publicFirecrawlCreditUsd } from "./firecrawl-plans";

/** Current default from config/pricing.yaml; UI can override using the live inferred plan. */
export const FIRECRAWL_CREDIT_USD = publicFirecrawlCreditUsd();

/** Labeled assumption only — never used as a silent plan-size default. */
export const FIRECRAWL_PLAN_CREDITS_ASSUMED = 100_000;

export type FirecrawlBalanceInput = {
  remaining: number | null;
  used: number | null;
  plan: number | null;
  planName?: string | null;
  creditUsd?: number | null;
  billingPeriodEnd?: string | null;
};

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
  firecrawlBalance: ProviderBalance | FirecrawlBalanceInput | undefined,
  byDay: CostDayRow[],
  snapshotJson?: unknown,
): CostBudget | null {
  const plan = firecrawlBalance?.plan ?? null;
  if (plan == null || plan <= 0) return null;

  const remaining = firecrawlBalance?.remaining ?? null;
  const usedThisCycle =
    firecrawlBalance?.used ??
    (remaining != null ? Math.max(plan - remaining, 0) : null);

  const billingPeriodEnd =
    firecrawlBalance?.billingPeriodEnd ??
    parseBillingPeriodEnd(snapshotJson) ??
    null;

  const recentDays = byDay.slice(-7);
  const recentCredits = recentDays.reduce((sum, row) => sum + row.firecrawlCredits, 0);
  const dailyAverageCredits = recentCredits / 7;

  let projectedCycleCredits: number | null = null;
  let projectedOverPlan = false;

  if (usedThisCycle != null && billingPeriodEnd) {
    const end = new Date(billingPeriodEnd);
    const now = new Date();
    const msLeft = end.getTime() - now.getTime();
    const daysLeft = Math.max(msLeft / (24 * 60 * 60 * 1000), 0);
    projectedCycleCredits = usedThisCycle + dailyAverageCredits * daysLeft;
    projectedOverPlan = projectedCycleCredits > plan;
  }

  const percentOfPlanUsed =
    usedThisCycle != null && plan > 0 ? (usedThisCycle / plan) * 100 : null;
  const inferredPlan = inferPublicFirecrawlPlan({ planCredits: plan });

  return {
    planCredits: plan,
    remainingCredits: remaining,
    usedThisCycle,
    billingPeriodEnd,
    dailyAverageCredits,
    projectedCycleCredits,
    projectedOverPlan,
    percentOfPlanUsed,
    planTier: inferredPlan?.key ?? null,
    planName: inferredPlan?.name ?? firecrawlBalance?.planName ?? null,
    creditUsd:
      firecrawlBalance?.creditUsd ??
      (inferredPlan && inferredPlan.monthlyUsd > 0
        ? inferredPlan.monthlyUsd / inferredPlan.monthlyCredits
        : FIRECRAWL_CREDIT_USD),
  };
}
