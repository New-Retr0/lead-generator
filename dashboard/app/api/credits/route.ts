import { NextResponse } from "next/server";
import { getCreditBalances } from "@/lib/db";
import { loadProjectEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type CreditsResponse = {
  firecrawl: {
    remaining: number | null;
    plan: number | null;
    periodEnd: string | null;
    live: boolean;
  };
  aiGateway: {
    balanceUsd: number | null;
    totalUsedUsd: number | null;
    live: boolean;
  };
  cachedAt: string;
};

let cache: { at: number; data: CreditsResponse } | null = null;
const CACHE_MS = 60_000;

async function fetchFirecrawlLive(apiKey: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      remainingCredits?: number;
      planCredits?: number;
      billingPeriodEnd?: string;
    };
  };
  const data = body.data ?? {};
  return {
    remaining: data.remainingCredits ?? null,
    plan: data.planCredits ?? null,
    periodEnd: data.billingPeriodEnd ?? null,
  };
}

async function fetchAiGatewayLive(apiKey: string) {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`AI Gateway HTTP ${res.status}`);
  const body = (await res.json()) as { balance?: number; total_used?: number };
  return {
    balanceUsd: typeof body.balance === "number" ? body.balance : null,
    totalUsedUsd: typeof body.total_used === "number" ? body.total_used : null,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.data);
  }

  const env = loadProjectEnv();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY;
  const aiKey = env.AI_GATEWAY_API_KEY ?? process.env.AI_GATEWAY_API_KEY;
  const snapshots = await getCreditBalances();
  const fcSnap = snapshots.find((b) => b.provider === "firecrawl");
  const aiSnap = snapshots.find((b) => b.provider === "ai_gateway");

  let firecrawl = {
    remaining: fcSnap?.remaining ?? null,
    plan: fcSnap?.plan ?? null,
    periodEnd: fcSnap?.billingPeriodEnd ?? null,
    live: false,
  };
  let aiGateway = {
    balanceUsd: aiSnap?.remaining ?? null,
    totalUsedUsd: aiSnap?.used ?? null,
    live: false,
  };

  if (firecrawlKey) {
    try {
      const live = await fetchFirecrawlLive(firecrawlKey);
      firecrawl = { ...live, live: true };
    } catch {
      // snapshot fallback
    }
  }

  if (aiKey) {
    try {
      const live = await fetchAiGatewayLive(aiKey);
      aiGateway = { ...live, live: true };
    } catch {
      // snapshot fallback
    }
  }

  const data: CreditsResponse = {
    firecrawl,
    aiGateway,
    cachedAt: new Date().toISOString(),
  };
  cache = { at: now, data };
  return NextResponse.json(data);
}
