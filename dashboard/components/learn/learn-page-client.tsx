"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/console/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type PlaybookRow = {
  profile_key: string;
  property_type: string;
  site_kind: string;
  brand: string;
  success_count: number;
  skip_firecrawl: boolean;
  trust_google_phone: boolean;
  winning_tier: string;
  contact_role_label: string;
  last_used_at: string | null;
};

export function LearnPageClient({
  playbooks,
}: {
  playbooks: PlaybookRow[];
}) {
  const skipCount = playbooks.filter((p) => p.skip_firecrawl).length;

  return (
    <div className="space-y-8" data-testid="learn-page">
      <div className="space-y-3">
        <SectionHeading index="01" title="Playbooks" />
        <p className="max-w-2xl text-sm text-muted-foreground">
          Operational cost learning from successful enrichments — not ML scoring.
          Franchise / management profiles teach when to trust a Google phone and skip
          Firecrawl. Outcome auto-ML is deferred (see{" "}
          <code className="text-foreground">docs/deferred-outcome-ml.md</code>).
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{playbooks.length} profiles</Badge>
          <Badge variant="outline">{skipCount} skip Firecrawl</Badge>
        </div>
      </div>

      <Card className="panel">
        <CardHeader>
          <CardTitle className="text-sm">Enrichment profiles</CardTitle>
          <CardDescription>
            Sorted by success count. Written by the pipeline via{" "}
            <code>learn_playbook_from_outcome</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {playbooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No playbooks yet — run a market to learn franchise / mgmt shortcuts.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-2 pr-3 font-medium">Profile</th>
                    <th className="py-2 pr-3 font-medium">Success</th>
                    <th className="py-2 pr-3 font-medium">Tier</th>
                    <th className="py-2 pr-3 font-medium">Fast path</th>
                    <th className="py-2 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {playbooks.map((row) => (
                    <tr key={row.profile_key} className="border-b border-border/40">
                      <td className="py-2.5 pr-3">
                        <p className="font-mono text-xs text-foreground">{row.profile_key}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.property_type} · {row.site_kind}
                          {row.brand ? ` · ${row.brand}` : ""}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{row.success_count}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">
                        {row.winning_tier || "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {row.skip_firecrawl ? (
                            <Badge variant="secondary" className="text-[10px]">
                              skip FC
                            </Badge>
                          ) : null}
                          {row.trust_google_phone ? (
                            <Badge variant="outline" className="text-[10px]">
                              trust phone
                            </Badge>
                          ) : null}
                          {!row.skip_firecrawl && !row.trust_google_phone ? (
                            <span className="text-xs text-muted-foreground">full enrich</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[14rem] truncate py-2.5 text-xs text-muted-foreground">
                        {row.contact_role_label || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/data">Open Data</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings?tab=yaml">YAML configs</Link>
        </Button>
      </div>
    </div>
  );
}
