"use client";

import { memo, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ShieldAlert } from "lucide-react";
import { SalesStatusBadge, ScoreBadge, VerificationBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
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
import type { LeadRow, PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

function triageReason(lead: LeadRow): string {
  if ((lead.lead_score ?? 0) < 40) return "Low score";
  if (lead.verification_level === "unverified") return "Unverified contact";
  if (lead.enrichment_status === "needs_manual") return "Needs manual review";
  if (lead.confidence === "Low") return "Low confidence";
  return "Needs attention";
}

type TriageRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  onOpen: (placeId: string) => void;
};

const TriageTableRow = memo(function TriageTableRow({
  lead,
  categoryLabel,
  onOpen,
}: TriageRowProps) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-accent/30"
      onClick={() => onOpen(lead.place_id)}
    >
      <TableCell className="font-medium">{lead.business_name}</TableCell>
      <TableCell>{lead.market_key ?? "—"}</TableCell>
      <TableCell>{categoryLabel}</TableCell>
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
  );
});

export function TriageClient({
  initialLeads,
  config,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
}) {
  const [leads] = useState(initialLeads);
  const [detailId, setDetailId] = useState<string | null>(null);

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config],
  );

  const openDetail = useCallback((placeId: string) => setDetailId(placeId), []);

  return (
    <div className="space-y-6">
      <PageHeader description="Leads that need attention — low score, unverified contacts, or flagged for manual follow-up. Open a row to inspect provenance; start a fresh market/category run to retry a lead (single-pass only — no separate re-enrich step)." />

      <Card className="glass min-w-0 !overflow-visible px-4 py-0">
        <div className="overflow-x-auto">
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
              {leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <ShieldAlert className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No leads need triage right now.</p>
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => (
                  <TriageTableRow
                    key={lead.place_id}
                    lead={lead}
                    categoryLabel={
                      categoryLabelMap.get(lead.category_key ?? "") ??
                      lead.category_key ??
                      "—"
                    }
                    onOpen={openDetail}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
