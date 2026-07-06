import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { createServiceRoleClient } from "@/lib/service-role";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminUser();
    const { id } = await context.params;
    const body = (await req.json()) as { active?: boolean };
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active boolean required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("partner_api_keys")
      .update({ active: body.active })
      .eq("id", id)
      .select(
        "id, key_prefix, partner_name, scopes, active, rate_limit_per_minute, daily_row_limit, created_at, last_used_at",
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    return NextResponse.json({ key: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update partner key";
    const status = message.includes("Admin access") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
