import { LearnPageClient, type PlaybookRow } from "@/components/learn/learn-page-client";
import { getEnrichmentPlaybooks } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LearnPage() {
  const rows = await getEnrichmentPlaybooks(80);
  const playbooks: PlaybookRow[] = rows.map((row) => ({
    profile_key: row.profile_key,
    property_type: row.property_type,
    site_kind: row.site_kind,
    brand: row.brand,
    success_count: row.success_count,
    skip_firecrawl: row.skip_firecrawl,
    trust_google_phone: row.trust_google_phone,
    winning_tier: row.winning_tier,
    contact_role_label: row.contact_role_label,
    last_used_at: row.last_used_at,
  }));

  return <LearnPageClient playbooks={playbooks} />;
}
