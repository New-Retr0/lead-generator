import Link from "next/link";
import { ExternalLink, KeyRound, Link2, ScrollText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PartnerKeyAdminPanel } from "@/components/partner-api/partner-key-admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin";

const baseUrl = "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1";

export default async function PartnerApiPage() {
  let isAdmin = false;
  try {
    const user = await getAuthenticatedUser();
    isAdmin = isAdminUser(user);
  } catch {
    isAdmin = false;
  }

  return (
    <div className="space-y-6">
      <PageHeader description="Partner pull-sync API for Pallares.us ingestion — OpenAPI spec, auth, and eligibility rules." />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="size-4 text-muted-foreground" />
              Base URL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="break-all text-xs text-muted-foreground">{baseUrl}</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" />
              Auth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <code>Authorization: Bearer ppl_...</code>
            <p>or</p>
            <code>x-api-key: ppl_...</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Eligibility
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Enriched leads with verified/partial verification and a callable phone only.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScrollText className="size-4 text-muted-foreground" />
              OpenAPI
            </CardTitle>
            <CardDescription>Machine-readable contract for integrators.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/api/partner-api/openapi" target="_blank">
              View YAML
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          See also{" "}
          <code className="text-xs">docs/partner-api.md</code> in the repo for narrative sync
          guidance and examples.
        </CardContent>
      </Card>

      {isAdmin ? <PartnerKeyAdminPanel /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Endpoints</CardTitle>
          <CardDescription>Cursor pull sync for Pallares ingestion.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`GET /health
GET /metadata
GET /leads?type=client&limit=100
GET /leads?type=vendor&updated_since=2026-06-01T00:00:00Z
GET /leads?cursor=<next_cursor>
GET /leads/{place_id}`}</pre>
          <p className="text-muted-foreground">
            List responses include <code>page.next_cursor</code>. Resume with that cursor until{" "}
            <code>has_more</code> is false, or restart from <code>updated_since</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Excluded from partner sync</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Low-confidence leads, unverified contacts, phone-less records, costs, run timelines,
            raw enriched JSON, CRM feedback, and service credentials.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
