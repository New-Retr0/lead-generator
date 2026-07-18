import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Plain `$` + digits — avoids locale currency glyphs that look raised/thin in UI type. */
function usdString(value: number, fractionDigits: number, maxFractionDigits?: number): string {
  const max = maxFractionDigits ?? fractionDigits;
  const abs = Math.abs(value);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: max,
  });
  return `${value < 0 ? "-" : ""}$${body}`;
}

export function formatUsd(value: number): string {
  return usdString(value, 2);
}

/** Per-unit / per-call amounts under a cent — up to 4 decimal places. */
export function formatUsdPrecise(value: number): string {
  return usdString(value, 2, 4);
}

/** Headline stat values — max 2 decimal places. */
export function formatUsdCompact(value: number): string {
  return usdString(value, 0, 2);
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const PROVIDER_LABELS: Record<string, string> = {
  firecrawl: "Firecrawl",
  browser_use: "Browser Use",
  google_places: "Google Places",
};

export function formatProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

export function formatCredits(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatFirecrawlBalanceSub(
  balance:
    | { remaining: number | null; used: number | null; plan: number | null }
    | undefined,
  pipelineCredits: number,
): string {
  if (!balance || balance.remaining == null) {
    if (pipelineCredits > 0) {
      return `${formatCredits(pipelineCredits)} tracked by pipeline this month`;
    }
    return "Run health check for live balance";
  }

  const parts: string[] = [];
  if (balance.used != null) {
    if (balance.plan != null) {
      parts.push(
        `${formatCredits(balance.used)} / ${formatCredits(balance.plan)} used this billing period`,
      );
    } else {
      parts.push(`${formatCredits(balance.used)} used this billing period`);
    }
  }
  if (pipelineCredits > 0) {
    parts.push(`${formatCredits(pipelineCredits)} tracked by pipeline`);
  }
  return parts.join(" · ");
}

export function formatFirecrawlLiveBalance(
  balance:
    | { remaining: number | null; used: number | null; plan: number | null }
    | undefined,
): string {
  if (!balance || balance.remaining == null) {
    return "Run health check for live balance";
  }

  const parts = [`${formatCredits(balance.remaining)} remaining`];
  if (balance.used != null) {
    if (balance.plan != null) {
      parts.push(`${formatCredits(balance.used)} / ${formatCredits(balance.plan)} used`);
    } else {
      parts.push(`${formatCredits(balance.used)} used`);
    }
  }
  return parts.join(" · ");
}

export function formatOverviewSpendSub(
  usdByProvider: { provider: string; usd: number }[],
): string {
  const shorts: Record<string, string> = {
    firecrawl: "FC",
    google_places: "Google",
    browser_use: "BU",
  };

  const top = [...usdByProvider]
    .filter((row) => row.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 3)
    .map((row) => {
      const label = shorts[row.provider] ?? formatProvider(row.provider);
      return `${label} ${formatUsd(row.usd)}`;
    });

  return top.length > 0 ? top.join(" · ") : "All providers";
}

export function formatCostUnits(
  provider: string,
  units: number,
  unitType: string,
): string {
  switch (unitType) {
    case "credits":
      return `${units.toFixed(0)} credits`;
    case "tokens":
      return `${units.toFixed(0)} tokens`;
    case "usd":
      return formatUsd(units);
    case "requests":
      return `${units.toFixed(0)} requests`;
    default:
      return `${units.toFixed(2)} ${unitType}`;
  }
}

export function balanceLabel(provider: string): string {
  if (provider === "firecrawl") return "credits";
  if (provider === "browser_use") return "USD";
  return "units";
}
