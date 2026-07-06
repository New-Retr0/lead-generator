import { NextRequest, NextResponse } from "next/server";
import { dbAvailable, getSql } from "@/lib/pg";
import { getPipelineConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

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
    let avgUsdPerLead = 0.12;
    let sampleSize = 0;

    if (dbAvailable()) {
      const sql = getSql();
      const rows = await sql`
        SELECT
          COUNT(DISTINCT place_id)::float AS lead_count,
          COALESCE(SUM(units) FILTER (WHERE provider = 'firecrawl'), 0)::float AS firecrawl_units,
          COALESCE(SUM(usd), 0)::float AS total_usd
        FROM cost_events
        WHERE place_id IS NOT NULL
      `;
      const row = rows[0];
      sampleSize = Number(row?.lead_count ?? 0);
      if (sampleSize > 0) {
        avgCreditsPerLead = Number(row.firecrawl_units) / sampleSize;
        avgUsdPerLead = Number(row.total_usd) / sampleSize;
      }

      if (categoryKeys.length === 1 && sampleSize >= 20) {
        const catRows = await sql`
          SELECT
            COUNT(DISTINCT ce.place_id)::float AS lead_count,
            COALESCE(SUM(ce.units) FILTER (WHERE ce.provider = 'firecrawl'), 0)::float AS firecrawl_units,
            COALESCE(SUM(ce.usd), 0)::float AS total_usd
          FROM cost_events ce
          JOIN leads l ON l.place_id = ce.place_id
          WHERE ce.place_id IS NOT NULL AND l.category_key = ${categoryKeys[0]}
        `;
        const catRow = catRows[0];
        const catSample = Number(catRow?.lead_count ?? 0);
        if (catSample >= 20) {
          avgCreditsPerLead = Number(catRow.firecrawl_units) / catSample;
          avgUsdPerLead = Number(catRow.total_usd) / catSample;
          sampleSize = catSample;
        }
      }
    }

    const estimatedCredits = Math.round(estimatedLeads * avgCreditsPerLead);
    const estimatedUsd = estimatedLeads * avgUsdPerLead;

    return NextResponse.json({
      campaign: campaignKey,
      markets: marketKeys.length,
      categories: categoryKeys.length,
      limit,
      estimatedLeads,
      estimatedCredits,
      estimatedUsd,
      avgCreditsPerLead: Math.round(avgCreditsPerLead * 10) / 10,
      avgUsdPerLead: Math.round(avgUsdPerLead * 1000) / 1000,
      sampleSize,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Estimate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
