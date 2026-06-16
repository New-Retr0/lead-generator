import { PageHeader } from "@/components/page-header";
import { RequestsBuilder } from "@/components/requests/requests-builder";
import { RunStatusBadge } from "@/components/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPipelineConfig } from "@/lib/config";
import { listRequests } from "@/lib/db";

export default async function RequestsPage() {
  const [requests, config] = await Promise.all([listRequests(), getPipelineConfig()]);

  return (
    <div className="space-y-6">
      <PageHeader description="Request a batch of qualified leads — build a precise spec or describe it in plain English. Each request runs discover + enrich in one pass per place." />

      <RequestsBuilder config={config} />

      <Card className="glass min-w-0">
        <CardHeader>
          <CardTitle>Request history</CardTitle>
          <CardDescription>
            Past requests with delivery counts and actual credit spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            requests.map((req) => (
              <details
                key={req.request_id}
                className="group rounded-lg border bg-card p-3 transition-colors hover:border-primary/25"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5">
                  <RunStatusBadge status={req.status} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {req.raw_prompt}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {req.leads_delivered} delivered · {req.credits_spent} cr
                    {req.usd_spent != null ? ` · $${req.usd_spent.toFixed(2)}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {req.created_at.slice(0, 16).replace("T", " ")}
                  </span>
                </summary>
                <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-secondary/60 p-3 font-mono text-xs">
                  {JSON.stringify(req.spec, null, 2)}
                </pre>
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
