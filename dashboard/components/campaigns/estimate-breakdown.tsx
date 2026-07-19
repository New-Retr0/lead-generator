"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { AnimatedNumber } from "@/components/animated";
import type { FirecrawlPlan } from "@/lib/types";
import { cn, formatCredits, formatUsd, formatUsdPrecise } from "@/lib/utils";

export type EstimateProvider = {
  provider: string;
  share: number;
  estimatedUsd: number;
  basis?: "current_credit_rate" | "historical_non_firecrawl";
};

export type EstimateBreakdownData = {
  estimatedCredits: number | null;
  estimatedFirecrawlUsd: number | null;
  estimatedUsd: number | null;
  creditUsd?: number | null;
  nextPlan?: FirecrawlPlan | null;
  pricingBasis?: string;
  avgCreditsPerLead: number | null;
  avgUsdPerLead: number | null;
  sampleSize: number;
  providers?: EstimateProvider[];
};

export type FirecrawlEstimateBalance = {
  remaining: number | null;
  plan: number | null;
  used?: number | null;
  planName?: string | null;
  creditUsd?: number | null;
  inferredPlan?: FirecrawlPlan | null;
  live?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  firecrawl: "Firecrawl",
  google_places: "Google Places",
  browser_use: "Browser Use",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

export function EstimateBreakdown({
  estimate,
  firecrawlBalance,
  compact = false,
}: {
  estimate: EstimateBreakdownData | null | undefined;
  firecrawlBalance?: FirecrawlEstimateBalance | null;
  compact?: boolean;
}) {
  const reduced = useSafeReducedMotion();

  if (!estimate?.estimatedCredits && estimate?.estimatedFirecrawlUsd == null) {
    return (
      <p className="font-mono text-[10px] text-muted-foreground">
        Select markets and categories
      </p>
    );
  }

  const providers = estimate.providers ?? [];
  const overRemaining =
    estimate.estimatedCredits != null &&
    firecrawlBalance?.remaining != null &&
    estimate.estimatedCredits > firecrawlBalance.remaining;
  const overMonthlyPlan =
    estimate.estimatedCredits != null &&
    firecrawlBalance?.plan != null &&
    estimate.estimatedCredits > firecrawlBalance.plan;
  const currentPlanName =
    firecrawlBalance?.planName ?? firecrawlBalance?.inferredPlan?.name ?? null;
  const currentPlanCredits =
    firecrawlBalance?.inferredPlan?.monthlyCredits ?? firecrawlBalance?.plan ?? null;
  const currentCreditUsd = firecrawlBalance?.creditUsd ?? estimate.creditUsd ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs">
        {estimate.estimatedCredits != null ? (
          <span className="font-bold tabular-nums text-warning">
            <AnimatedNumber value={estimate.estimatedCredits} /> cr
          </span>
        ) : null}
        {estimate.estimatedFirecrawlUsd != null ? (
          <span className="tabular-nums text-muted-foreground">
            ~{formatUsd(estimate.estimatedFirecrawlUsd)} Firecrawl current-rate
          </span>
        ) : null}
        {currentCreditUsd != null ? (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            ({formatUsdPrecise(currentCreditUsd)}/credit)
          </span>
        ) : null}
      </div>

      {providers.length > 0 && estimate.estimatedUsd != null ? (
        <div className={compact ? "space-y-1.5" : "space-y-2"}>
          {providers.map((row) => (
            <div key={row.provider} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted-foreground">
                  {providerLabel(row.provider)}
                  {row.basis === "current_credit_rate" ? " current" : ""}
                </span>
                <span className="font-mono tabular-nums">
                  <AnimatedNumber value={row.estimatedUsd} format={formatUsd} />
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${Math.round(row.share * 100)}%` }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 120, damping: 20 }
                  }
                />
              </div>
            </div>
          ))}
          <p className="font-mono text-[10px] text-muted-foreground">
            Total projected{" "}
            <AnimatedNumber value={estimate.estimatedUsd} format={formatUsd} /> all providers
          </p>
        </div>
      ) : estimate.estimatedUsd != null ? (
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatUsd(estimate.estimatedUsd)} all providers
        </p>
      ) : null}

      {estimate.sampleSize > 0 ? (
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          projected from {estimate.sampleSize} historical leads
          {estimate.avgUsdPerLead != null
            ? ` · avg ${formatUsd(estimate.avgUsdPerLead)}/lead`
            : ""}
          {estimate.avgCreditsPerLead != null
            ? ` · ${estimate.avgCreditsPerLead} cr/lead`
            : ""}
        </p>
      ) : null}

      {firecrawlBalance ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 font-mono text-[10px] leading-relaxed",
            overRemaining || overMonthlyPlan
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border/50 bg-muted/25 text-muted-foreground",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {currentPlanName ? `${currentPlanName} plan` : "Firecrawl plan"}
              {currentPlanCredits != null
                ? ` - ${formatCredits(currentPlanCredits)} credits/mo`
                : ""}
            </span>
            <span>
              {firecrawlBalance.remaining != null
                ? `${formatCredits(firecrawlBalance.remaining)} remaining`
                : "live balance unavailable"}
            </span>
          </div>
          {overRemaining ? (
            <p className="mt-1">
              Estimate is above remaining credits. Recharge, wait for renewal, or reduce
              markets/categories before launch.
            </p>
          ) : null}
          {overMonthlyPlan && estimate.nextPlan ? (
            <p className="mt-1">
              For one-cycle coverage, next public plan match is {estimate.nextPlan.name} (
              {formatCredits(estimate.nextPlan.monthlyCredits)} credits/mo).
            </p>
          ) : null}
        </div>
      ) : null}

      {estimate.pricingBasis ? (
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          {estimate.pricingBasis}
        </p>
      ) : null}
    </div>
  );
}

export function useSpendProviderSummary(
  byProvider7d: { provider: string; usd: number }[],
  maxNames = 2,
): string {
  return useMemo(() => {
    const sorted = [...byProvider7d].sort((a, b) => b.usd - a.usd);
    const top = sorted.slice(0, maxNames);
    const rest = sorted.length - top.length;
    if (top.length === 0) return "all providers";
    const parts = top.map((r) => `${providerLabel(r.provider)} ${formatUsd(r.usd)}`);
    if (rest > 0) parts.push(`+${rest}`);
    return parts.join(" · ");
  }, [byProvider7d, maxNames]);
}
