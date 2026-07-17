import { FIRECRAWL_PLAN_CREDITS_ASSUMED } from "./cost-budget";
import { getFirecrawlCreditUsd, inferFirecrawlPlan } from "./config";
import { getCreditBalances } from "./db";

export type RequestCreditBudget = {
  maxFirecrawlCredits: number;
  firecrawlPlanName: string | null;
  firecrawlCreditUsd: number;
  source: "live" | "configured";
};

function positiveNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function planCreditUsd(planCredits: number): number {
  const plan = inferFirecrawlPlan({ planCredits });
  if (plan && plan.monthlyUsd > 0 && plan.monthlyCredits > 0) {
    return plan.monthlyUsd / plan.monthlyCredits;
  }
  return getFirecrawlCreditUsd();
}

export async function getRequestCreditBudget(): Promise<RequestCreditBudget> {
  const balances = await getCreditBalances();
  const firecrawl = balances.find((balance) => balance.provider === "firecrawl");
  const livePlanCredits = positiveNumber(firecrawl?.plan);

  if (livePlanCredits != null) {
    return {
      maxFirecrawlCredits: livePlanCredits,
      firecrawlPlanName:
        firecrawl?.planName ??
        inferFirecrawlPlan({ planCredits: livePlanCredits })?.name ??
        null,
      firecrawlCreditUsd: firecrawl?.creditUsd ?? planCreditUsd(livePlanCredits),
      source: "live",
    };
  }

  const configuredPlan = inferFirecrawlPlan({});
  const configuredPlanCredits =
    positiveNumber(configuredPlan?.monthlyCredits) ?? FIRECRAWL_PLAN_CREDITS_ASSUMED;

  return {
    maxFirecrawlCredits: configuredPlanCredits,
    firecrawlPlanName: configuredPlan?.name ?? null,
    firecrawlCreditUsd: planCreditUsd(configuredPlanCredits),
    source: "configured",
  };
}
