"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { SalesStatusBadge, ScoreBadge, VerificationBadge } from "@/components/badges";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePipelineConfig } from "@/hooks/use-pipeline-config";
import type { LeadRow } from "@/lib/types";

function triageReason(lead: LeadRow): string {
  if ((lead.lead_score ?? 0) < 40) return "Low score";
  if (lead.verification_level === "unverified") return "Unverified contact";
  if (lead.enrichment_status === "needs_manual") return "Needs manual review";
  if (lead.confidence === "Low") return "Low confidence";
  return "Needs attention";
}

export default function TriagePage() {
  const { config, loaded } = usePipelineConfig();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch("/api/leads?dudsOnly=1&limit=200");
        const data = (await res.json()) as { leads?: LeadRow[] };
        if (!cancelled) setLeads(data.leads ?? []);
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryLabel = (key: string | null) =>
    config.categories.find((c) => c.key === key)?.label ?? key ?? "—";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Leads that need attention — low score, unverified contacts, or flagged for manual follow-up.
        Open a row to inspect provenance; start a fresh market/category run to retry a lead
        (single-pass only — no separate re-enrich step).
      </p>

      <Card className="glass !overflow-visible px-4 py-0">
        <Table>
          <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead>Business</TableHead>
              <TableHead>Market</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loaded || loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  Loading triage queue…
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <ShieldAlert className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No leads need triage right now.</p>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow
                  key={lead.place_id}
                  className="cursor-pointer hover:bg-accent/30"
                  onClick={() => setDetailId(lead.place_id)}
                >
                  <TableCell className="font-medium">{lead.business_name}</TableCell>
                  <TableCell>{lead.market_key ?? "—"}</TableCell>
                  <TableCell>{categoryLabel(lead.category_key)}</TableCell>
                  <TableCell className="text-center">
                    <ScoreBadge score={lead.lead_score} />
                  </TableCell>
                  <TableCell>
                    <VerificationBadge level={lead.verification_level} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{triageReason(lead)}</Badge>
                  </TableCell>
                  <TableCell>
                    <SalesStatusBadge status={lead.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
