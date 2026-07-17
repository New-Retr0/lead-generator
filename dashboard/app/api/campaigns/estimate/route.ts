import { NextRequest, NextResponse } from "next/server";
import { dbAvailable, getSql } from "@/lib/pg";
import {
  getFirecrawlCreditUsd,
  getNextFirecrawlPlan,
  getPipelineConfig,
} from "@/lib/config";

export const dynamic = "force-dynamic";

type ProviderEstimate = {
  provider: string;
  share: number;
  estimatedUsd: number;
  basis: "current_credit_rate" | "historical_non_firecrawl";
};

type CostSample = {
  leadCount: number;
  firecrawlUnits: number;
  providers: { provider: string; usd: number; units: number }[];
};

async function loadSample(categoryKey?: string): Promise<CostSample> {
  const sql = getSql();
  if (categoryKey) {
    const rows = await sql`
      SELECT
        COUNT(DISTINCT ce.place_id)::float AS lead_count,
        COALESCE(SUM(ce.units) FILTER (WHERE ce.provider = 'firecrawl'), 0)::float AS firecrawl_units
      FROM cost_events ce
      JOIN leads l ON l.place_id = ce.place_id
      WHERE ce.place_id IS NOT NULL AND l.category_key = ${categoryKey}
    `;
    const providerRows = await sql`
      SELECT ce.provider,
             COALESCE(SUM(ce.usd), 0)::float AS usd,
             COALESCE(SUM(ce.units), 0)::float AS units
      FROM cost_events ce
      JOIN leads l ON l.place_id = ce.place_id
      WHERE ce.place_id IS NOT NULL AND l.category_key = ${categoryKey}
      GROUP BY ce.provider
      ORDER BY usd DESC
    `;
    return {
      leadCount: Number(rows[0]?.lead_count ?? 0),
      firecrawlUnits: Number(rows[0]?.firecrawl_units ?? 0),
      providers: providerRows.map((row) => ({
        provider: String(row.provider),
        usd: Number(row.usd),
        units: Number(row.units),
      })),
    };
  }

  const rows = await sql`
    SELECT
      COUNT(DISTINCT place_id)::float AS lead_count,
      COALESCE(SUM(units) FILTER (WHERE provider = 'firecrawl'), 0)::float AS firecrawl_units
    FROM cost_events
    WHERE place_id IS NOT NULL
  `;
  const providerRows = await sql`
    SELECT provider,
           COALESCE(SUM(usd), 0)::float AS usd,
           COALESCE(SUM(units), 0)::float AS units
    FROM cost_events
    WHERE place_id IS NOT NULL
    GROUP BY provider
    ORDER BY usd DESC
  `;
  return {
    leadCount: Number(rows[0]?.lead_count ?? 0),
    firecrawlUnits: Number(rows[0]?.firecrawl_units ?? 0),
    providers: providerRows.map((row) => ({
      provider: String(row.provider),
      usd: Number(row.usd),
      units: Number(row.units),
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const campaignKey = params.get("campaign") ?? "";
    const marketsParam = params.get("markets") ?? "";
    const categoriesParam = params.get("categories") ?? "";
    const limit = Math.max(1, Number(params.get("limit") ?? "20") || 20);

    const config = getPipelineConfig();
    const campaign = config.campaigns.find((c) => c.key === campaignKey);
    if (!campaign) {
      return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
    }

    const marketKeys = marketsParam
      ? marketsParam.split(",").filter(Boolean)
      : campaign.markets;
    const categoryKeys = categoriesParam
      ? categoriesParam.split(",").filter(Boolean)
      : campaign.categories;

    const combos = marketKeys.length * Math.max(categoryKeys.length, 1);
    const estimatedLeads = combos * limit;

    let avgCreditsPerLead = 45;
    let avgUsdPerLead = 0;
    let sampleSize = 0;
    let sample: CostSample | null = null;

    if (dbAvailable()) {
      sample = await loadSample();
      sampleSize = sample.leadCount;

      if (categoryKeys.length === 1 && sampleSize >= 20) {
        const categorySample = await loadSample(categoryKeys[0]);
        if (categorySample.leadCount >= 20) {
          sample = categorySample;
          sampleSize = categorySample.leadCount;
        }
      }

      if (sampleSize > 0 && sample) {
        avgCreditsPerLead = sample.firecrawlUnits / sampleSize;
      }
    }

    const estimatedCredits = Math.round(estimatedLeads * avgCreditsPerLead);
    const creditUsd = getFirecrawlCreditUsd();
    const estimatedFirecrawlUsd = estimatedCredits * creditUsd;
    const nextPlan = getNextFirecrawlPlan(estimatedCredits);

    let providers: ProviderEstimate[] = [
      {
        provider: "firecrawl",
        share: 1,
        estimatedUsd: estimatedFirecrawlUsd,
        basis: "current_credit_rate",
      },
    ];
    if (sample && sampleSize > 0) {
      const nonFirecrawl = sample.providers
        .filter((row) => row.provider !== "firecrawl")
        .map((row) => ({
          provider: row.provider,
          share: 0,
          estimatedUsd: estimatedLeads * (row.usd / sampleSize),
          basis: "historical_non_firecrawl" as const,
        }))
        .filter((row) => row.estimatedUsd > 0);
      providers = [...providers, ...nonFirecrawl];
    }
    const estimatedUsd = providers.reduce((sum, row) => sum + row.estimatedUsd, 0);
    avgUsdPerLead = estimatedLeads > 0 ? estimatedUsd / estimatedLeads : 0;
    providers = providers
      .map((row) => ({
        ...row,
        share: estimatedUsd > 0 ? row.estimatedUsd / estimatedUsd : 0,
      }))
      .sort((a, b) => b.estimatedUsd - a.estimatedUsd);

    return NextResponse.json({
      campaign: campaignKey,
      markets: marketKeys.length,
      categories: categoryKeys.length,
      limit,
      estimatedLeads,
      estimatedCredits,
      estimatedFirecrawlUsd,
      estimatedUsd,
      creditUsd,
      nextPlan,
      pricingBasis:
        "Firecrawl uses current configured plan USD/credit; other providers use historical non-Firecrawl USD/lead.",
      avgCreditsPerLead: Math.round(avgCreditsPerLead * 10) / 10,
      avgUsdPerLead: Math.round(avgUsdPerLead * 1000) / 1000,
      sampleSize,
      providers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Estimate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
