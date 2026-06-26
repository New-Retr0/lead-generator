import { KeyRound, Link2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const baseUrl = "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1";

export default function PartnerApiPage() {
  return (
    <div className="space-y-6">
      <PageHeader description="Ben's integration uses a dedicated partner key and sanitized lead payloads. Supabase service keys never leave your control." />

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
          <CardContent>
            <code className="text-xs text-muted-foreground">Authorization: Bearer ppl_...</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Scope
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Read-only access to approved callable lead fields.
            </p>
          </CardContent>
        </Card>
      </div>

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
            List responses include <code>page.next_cursor</code>. Ben should keep requesting
            with that cursor until <code>has_more</code> is false, then resume later with
            the last stored cursor or an <code>updated_since</code> timestamp.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Included fields</CardTitle>
          <CardDescription>Lean list payload, richer detail payload.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <h2 className="mb-2 font-medium">List</h2>
            <p className="text-muted-foreground">
              Lead id, type, business, category, market, address, website, maps URL,
              callable phone, best contact, score, confidence, verification, need
              signals, talking points, and enrichment timestamps.
            </p>
          </div>
          <div>
            <h2 className="mb-2 font-medium">Detail</h2>
            <p className="text-muted-foreground">
              List fields plus site contacts, evidence URLs, grouped facts, score
              breakdown, coordinates, and relevant notes.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Excluded</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Costs, credit usage, run timelines, raw enriched JSON, CRM feedback,
            request internals, failed developer triage, and service credentials are not
            exposed through the partner API.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
