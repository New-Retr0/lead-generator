import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { projectRoot } from "./paths";
import type { CategoryOption, MarketOption, PipelineConfig } from "./types";

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

export function getPipelineConfig(): PipelineConfig {
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
