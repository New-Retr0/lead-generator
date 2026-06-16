"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { RunStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunRow } from "@/lib/types";

const RunDetailModal = dynamic(
  () => import("@/components/run-detail-modal").then((m) => m.RunDetailModal),
  { ssr: false },
);

export function RunsTableClient({ initialRuns }: { initialRuns: RunRow[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);

  const refreshRuns = () => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => setRuns(data.runs ?? []));
  };

  return (
    <div className="space-y-6">
      <PageHeader description="Pipeline run history — read-only view of discovery and enrichment runs." />

      <Card className="glass min-w-0">
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Persisted runs from the lead database. Click a row for cost summary and timeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs in database yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-card/40 hover:bg-card/40">
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Market / Category</TableHead>
                  <TableHead className="text-right">Discovered</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="whitespace-nowrap">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.run_id}
                    className="cursor-pointer transition-colors hover:bg-accent/25"
                    onClick={() => setDetailRunId(run.run_id)}
                  >
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.run_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {run.market_key ?? "—"}
                      {run.category_key ? (
                        <span className="text-muted-foreground"> / {run.category_key}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.discovered_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {run.skipped_known_count}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {run.enriched_count}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {run.started_at.slice(0, 16).replace("T", " ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RunDetailModal
        runId={detailRunId}
        onClose={() => setDetailRunId(null)}
        onRunFinished={refreshRuns}
      />
    </div>
  );
}
