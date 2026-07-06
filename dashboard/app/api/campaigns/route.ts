import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { getPipelineConfig } from "@/lib/config";
import { projectRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

type CampaignYaml = {
  campaigns: Record<
    string,
    {
      description?: string;
      markets?: string[];
      categories?: string[];
      exclude_counties?: string[];
    }
  >;
};

type MarketsYaml = {
  markets: Record<
    string,
    {
      city: string;
      state: string;
      county?: string;
      search_radius_m?: number;
      grid_radius_m?: number;
    }
  >;
};

export async function GET() {
  try {
    const config = getPipelineConfig();
    const campaignRaw = parse(
      readFileSync(path.join(projectRoot(), "config", "campaign.yaml"), "utf8"),
    ) as CampaignYaml;
    const marketsRaw = parse(
      readFileSync(path.join(projectRoot(), "config", "markets.yaml"), "utf8"),
    ) as MarketsYaml;

    const marketMap = marketsRaw.markets ?? {};
    const campaigns = Object.entries(campaignRaw.campaigns ?? {}).map(([key, c]) => {
      const marketKeys = c.markets ?? [];
      const markets = marketKeys.map((mk) => {
        const m = marketMap[mk];
        return {
          key: mk,
          city: m?.city ?? mk,
          state: m?.state ?? "",
          gridRadiusM: m?.grid_radius_m ?? m?.search_radius_m ?? null,
        };
      });
      return {
        key,
        description: c.description ?? key,
        markets,
        categories: c.categories ?? [],
        excludeCounties: c.exclude_counties ?? [],
      };
    });

    return NextResponse.json({
      campaigns,
      allCategories: config.categories,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load campaigns";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
