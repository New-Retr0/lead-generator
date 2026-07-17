import { readFileSync } from "fs";
import path from "path";
import { cache } from "react";
import { parse } from "yaml";
import { projectRoot } from "./paths";
import type { CategoryOption, FirecrawlPlan, MarketOption, PipelineConfig } from "./types";

type MarketsYaml = {
  markets: Record<
    string,
    { city: string; state: string; county?: string; search_radius_m?: number }
  >;
};

type CategoriesYaml = {
  categories: Record<
    string,
    {
      label?: string;
      property_type?: string;
      source?: string;
      enrichment?: Record<string, unknown>;
    }
  >;
};

type CampaignYaml = {
  campaigns: Record<string, { markets?: string[]; categories?: string[] }>;
};

function readYaml<T>(file: string): T {
  const fullPath = path.join(projectRoot(), "config", file);
  return parse(readFileSync(fullPath, "utf8")) as T;
}

function titleize(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

let cached: PipelineConfig | null = null;

function loadPipelineConfig(): PipelineConfig {
  if (cached) return cached;

  const marketsYaml = readYaml<MarketsYaml>("markets.yaml");
  const categoriesYaml = readYaml<CategoriesYaml>("categories.yaml");
  const campaignYaml = readYaml<CampaignYaml>("campaign.yaml");

  const markets: MarketOption[] = Object.entries(marketsYaml.markets).map(
    ([key, m]) => ({
      key,
      city: m.city,
      state: m.state,
      county: m.county ?? null,
    }),
  );

  const categories: CategoryOption[] = Object.entries(
    categoriesYaml.categories,
  ).map(([key, c]) => {
    const enrichment = c.enrichment ?? {};
    return {
      key,
      label: c.label ?? titleize(key),
      recurring: Boolean(enrichment.suggest_recurring),
      ownerChain: Boolean(enrichment.allow_owner_chain),
      source: (c.source as string | undefined) ?? "google_places",
    };
  });

  const campaigns = Object.entries(campaignYaml.campaigns ?? {}).map(
    ([key, c]) => ({
      key,
      markets: c.markets ?? [],
      categories: c.categories ?? [],
    }),
  );

  cached = { markets, categories, campaigns };
  return cached;
}

export const getPipelineConfig = cache(loadPipelineConfig);

type PricingYamlPlan = {
  name?: string;
  monthly_credits?: number;
  monthly_usd?: number;
  billing?: string;
  concurrent_browsers?: number;
  max_queued_jobs?: number;
  rate_limits_rpm?: {
    scrape?: number;
    map?: number;
    crawl?: number;
    search?: number;
    agent?: number;
  };
};

type PricingYaml = {
  firecrawl?: {
    credit_usd?: number;
    default_plan_key?: string;
    plans?: Record<string, PricingYamlPlan>;
  };
};

const DEFAULT_FIRECRAWL_PLAN: FirecrawlPlan = {
  key: "standard",
  name: "Standard",
  monthlyCredits: 100000,
  monthlyUsd: 83,
  billing: "billed yearly",
  concurrentBrowsers: 50,
  maxQueuedJobs: 100000,
  rateLimitsRpm: {
    scrape: 500,
    map: 500,
    crawl: 50,
    search: 250,
    agent: 500,
  },
};

function loadPricing(): PricingYaml {
  try {
    return readYaml<PricingYaml>("pricing.yaml");
  } catch {
    return {};
  }
}

export function getFirecrawlPlans(): FirecrawlPlan[] {
  const pricing = loadPricing();
  const plans = pricing.firecrawl?.plans;
  if (!plans) return [DEFAULT_FIRECRAWL_PLAN];

  const parsed = Object.entries(plans)
    .map(([key, plan]) => ({
      key,
      name: plan.name ?? titleize(key),
      monthlyCredits: Number(plan.monthly_credits ?? 0),
      monthlyUsd: Number(plan.monthly_usd ?? 0),
      billing: plan.billing ?? null,
      concurrentBrowsers: Number(plan.concurrent_browsers ?? 0),
      maxQueuedJobs: Number(plan.max_queued_jobs ?? 0),
      rateLimitsRpm: {
        scrape: Number(plan.rate_limits_rpm?.scrape ?? 0),
        map: Number(plan.rate_limits_rpm?.map ?? 0),
        crawl: Number(plan.rate_limits_rpm?.crawl ?? 0),
        search: Number(plan.rate_limits_rpm?.search ?? 0),
        agent: Number(plan.rate_limits_rpm?.agent ?? 0),
      },
    }))
    .filter((plan) => plan.monthlyCredits > 0 || plan.monthlyUsd === 0)
    .sort((a, b) => a.monthlyCredits - b.monthlyCredits);

  return parsed.length > 0 ? parsed : [DEFAULT_FIRECRAWL_PLAN];
}

export function inferFirecrawlPlan({
  planCredits,
  maxConcurrency,
}: {
  planCredits?: number | null;
  maxConcurrency?: number | null;
}): FirecrawlPlan | null {
  const plans = getFirecrawlPlans();
  if (planCredits != null) {
    const byCredits = plans.find((plan) => plan.monthlyCredits === planCredits);
    if (byCredits) return byCredits;
  }
  if (maxConcurrency != null) {
    const byConcurrency = plans.find((plan) => plan.concurrentBrowsers === maxConcurrency);
    if (byConcurrency) return byConcurrency;
  }
  const pricing = loadPricing();
  const defaultKey = pricing.firecrawl?.default_plan_key;
  return plans.find((plan) => plan.key === defaultKey) ?? null;
}

export function getNextFirecrawlPlan(requiredCredits: number): FirecrawlPlan | null {
  return (
    getFirecrawlPlans().find((plan) => plan.monthlyCredits >= requiredCredits) ?? null
  );
}

export function getFirecrawlCreditUsd(): number {
  const pricing = loadPricing();
  const plan = inferFirecrawlPlan({});
  if (plan && plan.monthlyUsd > 0 && plan.monthlyCredits > 0) {
    return plan.monthlyUsd / plan.monthlyCredits;
  }
  return pricing.firecrawl?.credit_usd ?? 0.00083;
}
