import { NextRequest, NextResponse } from "next/server";
import { listLeads } from "@/lib/db";
import { parseInventoryMode } from "@/lib/lead-labels";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const leads = await listLeads({
      market: params.get("market") || undefined,
      category: params.get("category") || undefined,
      status: params.get("status") || undefined,
      crmStatus: params.get("crmStatus") || undefined,
      type: params.get("type") || undefined,
      inventoryMode: parseInventoryMode(params.get("inventory")),
      minScore: params.has("minScore")
        ? Number(params.get("minScore"))
        : undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : 500,
    });
    return NextResponse.json({ leads });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
