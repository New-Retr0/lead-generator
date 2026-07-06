import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { createServiceRoleClient } from "@/lib/service-role";

export const dynamic = "force-dynamic";

const ALLOWED_SCOPES = ["leads:read", "leads:feedback"] as const;

function parseScopes(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return ["leads:read"];
  }
  if (!Array.isArray(raw)) {
    throw new Error("scopes must be an array");
  }
  const scopes = raw.map((s) => String(s).trim()).filter(Boolean);
  if (scopes.length === 0) {
    throw new Error("scopes must include at least one value");
  }
  const invalid = scopes.filter((s) => !ALLOWED_SCOPES.includes(s as (typeof ALLOWED_SCOPES)[number]));
  if (invalid.length > 0) {
    throw new Error(`Invalid scopes: ${invalid.join(", ")}. Allowed: ${ALLOWED_SCOPES.join(", ")}`);
  }
  return [...new Set(scopes)];
}

function makePartnerKey(): string {
  return `ppl_${randomBytes(27).toString("base64url")}`;
}

export async function GET() {
  try {
    await requireAdminUser();
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("partner_api_keys")
      .select(
        "id, key_prefix, partner_name, scopes, active, rate_limit_per_minute, daily_row_limit, created_at, last_used_at, expires_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ keys: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list partner keys";
    const status = message.includes("Admin access") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminUser();
    const body = (await req.json()) as {
      partner_name?: string;
      rate_limit_per_minute?: number;
      daily_row_limit?: number;
      deactivate_existing?: boolean;
      scopes?: string[];
    };

    const partnerName = body.partner_name?.trim() || "Partner";
    const scopes = parseScopes(body.scopes);
    const rateLimit = Number(body.rate_limit_per_minute ?? 60);
    const dailyRowLimit = Number(body.daily_row_limit ?? 10_000);
    const apiKey = makePartnerKey();
    const keyPrefix = apiKey.slice(0, 16);
    const keyHash = createHash("sha256").update(apiKey).digest("hex");

    const supabase = createServiceRoleClient();

    if (body.deactivate_existing) {
      const { error: deactivateError } = await supabase
        .from("partner_api_keys")
        .update({ active: false })
        .eq("partner_name", partnerName)
        .eq("active", true);
      if (deactivateError) throw new Error(deactivateError.message);
    }

    const { data, error } = await supabase
      .from("partner_api_keys")
      .insert({
        key_prefix: keyPrefix,
        key_hash: keyHash,
        partner_name: partnerName,
        scopes,
        rate_limit_per_minute: rateLimit,
        daily_row_limit: dailyRowLimit,
      })
      .select(
        "id, key_prefix, partner_name, scopes, active, rate_limit_per_minute, daily_row_limit, created_at",
      )
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      key: data,
      api_key: apiKey,
      header: `Authorization: Bearer ${apiKey}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create partner key";
    const status = message.includes("Admin access")
      ? 403
      : message.includes("scopes") || message.includes("Invalid scopes")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
