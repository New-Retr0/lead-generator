import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const PROVIDER_LABELS: Record<string, string> = {
  firecrawl: "Firecrawl",
  browser_use: "Browser Use",
  ai_gateway: "AI Gateway",
  google_places: "Google Places",
};

export function formatProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
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
