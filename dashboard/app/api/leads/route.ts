import { NextRequest, NextResponse } from "next/server";
import { listFilterOptions, listLeads } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const leads = listLeads({
      market: params.get("market") || undefined,
      category: params.get("category") || undefined,
      status: params.get("status") || undefined,
      crmStatus: params.get("crmStatus") || undefined,
      type: params.get("type") || undefined,
      minScore: params.has("minScore")
        ? Number(params.get("minScore"))
        : undefined,
      dudsOnly: params.get("dudsOnly") === "1",
      limit: params.has("limit") ? Number(params.get("limit")) : 500,
    });
    const filters = listFilterOptions();
    return NextResponse.json({ leads, filters });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
