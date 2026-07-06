"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedNumber } from "@/components/animated";
import { formatUsd } from "@/lib/utils";

export type EstimateProvider = {
  provider: string;
  share: number;
  estimatedUsd: number;
};

export type EstimateBreakdownData = {
  estimatedCredits: number | null;
  estimatedFirecrawlUsd: number | null;
  estimatedUsd: number | null;
  avgCreditsPerLead: number | null;
  avgUsdPerLead: number | null;
  sampleSize: number;
  providers?: EstimateProvider[];
};

const PROVIDER_LABELS: Record<string, string> = {
  firecrawl: "Firecrawl",
  google_places: "Google Places",
  browser_use: "Browser Use",
  ai_gateway: "AI Gateway",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

export function EstimateBreakdown({
  estimate,
  compact = false,
}: {
  estimate: EstimateBreakdownData | null | undefined;
  compact?: boolean;
}) {
  const reduced = useReducedMotion();

  if (!estimate?.estimatedCredits && estimate?.estimatedFirecrawlUsd == null) {
    return (
      <p className="font-mono text-[10px] text-muted-foreground">
        Select markets and categories
      </p>
    );
  }

  const providers = estimate.providers ?? [];

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
            ~{formatUsd(estimate.estimatedFirecrawlUsd)} Firecrawl
          </span>
        ) : null}
      </div>

      {providers.length > 0 && estimate.estimatedUsd != null ? (
        <div className={compact ? "space-y-1.5" : "space-y-2"}>
          {providers.map((row) => (
            <div key={row.provider} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted-foreground">{providerLabel(row.provider)}</span>
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
