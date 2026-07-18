/**
 * Client-safe Firecrawl plan table for USD/credit estimates in the browser.
 * Keep in sync with config/pricing.yaml (server YAML remains canonical for doctor/API).
 */
import type { FirecrawlPlan } from "./types";

/** Standard annual-billing rate: $83 / 100_000 ≈ $0.00083 per credit. */
export const DEFAULT_FIRECRAWL_CREDIT_USD = 83 / 100_000;

export const FIRECRAWL_PLANS: FirecrawlPlan[] = [
  {
    key: "free",
    name: "Free",
    monthlyCredits: 1000,
    monthlyUsd: 0,
    billing: null,
    concurrentBrowsers: 2,
    maxQueuedJobs: 50000,
    rateLimitsRpm: { scrape: 10, map: 10, crawl: 1, search: 5, agent: 10 },
  },
  {
    key: "hobby",
    name: "Hobby",
    monthlyCredits: 5000,
    monthlyUsd: 16,
    billing: "billed yearly",
    concurrentBrowsers: 5,
    maxQueuedJobs: 50000,
    rateLimitsRpm: { scrape: 100, map: 100, crawl: 15, search: 50, agent: 100 },
  },
  {
    key: "standard",
    name: "Standard",
    monthlyCredits: 100000,
    monthlyUsd: 83,
    billing: "billed yearly",
    concurrentBrowsers: 50,
    maxQueuedJobs: 100000,
    rateLimitsRpm: { scrape: 500, map: 500, crawl: 50, search: 250, agent: 500 },
  },
  {
    key: "growth",
    name: "Growth",
    monthlyCredits: 500000,
    monthlyUsd: 333,
    billing: "billed yearly",
    concurrentBrowsers: 100,
    maxQueuedJobs: 200000,
    rateLimitsRpm: { scrape: 5000, map: 5000, crawl: 250, search: 2500, agent: 1000 },
  },
  {
    key: "scale",
    name: "Scale",
    monthlyCredits: 1000000,
    monthlyUsd: 599,
    billing: "billed yearly",
    concurrentBrowsers: 150,
    maxQueuedJobs: 300000,
    rateLimitsRpm: { scrape: 7500, map: 7500, crawl: 750, search: 7500, agent: 1000 },
  },
];

export function inferFirecrawlPlanClient({
  planCredits,
  maxConcurrency,
}: {
  planCredits?: number | null;
  maxConcurrency?: number | null;
}): FirecrawlPlan | null {
  if (planCredits != null) {
    const byCredits = FIRECRAWL_PLANS.find((plan) => plan.monthlyCredits === planCredits);
    if (byCredits) return byCredits;
  }
  if (maxConcurrency != null) {
    const byConcurrency = FIRECRAWL_PLANS.find(
      (plan) => plan.concurrentBrowsers === maxConcurrency,
    );
    if (byConcurrency) return byConcurrency;
  }
  return FIRECRAWL_PLANS.find((plan) => plan.key === "standard") ?? null;
}

export function firecrawlCreditUsdClient(planCredits?: number | null): number {
  const plan = inferFirecrawlPlanClient({ planCredits });
  if (plan && plan.monthlyUsd > 0 && plan.monthlyCredits > 0) {
    return plan.monthlyUsd / plan.monthlyCredits;
  }
  return DEFAULT_FIRECRAWL_CREDIT_USD;
}
