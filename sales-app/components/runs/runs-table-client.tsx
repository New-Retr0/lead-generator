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

function startedLabel(startedAt: string): string {
  return startedAt.slice(0, 16).replace("T", " ");
}

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
      <PageHeader description="Pipeline run history - read-only view of discovery and enrichment runs." />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Persisted runs from the lead database. Click a row for cost summary and timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs in database yet.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {runs.map((run) => (
                  <button
                    key={run.run_id}
                    type="button"
                    className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent/25"
                    onClick={() => setDetailRunId(run.run_id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <Badge variant="outline">{run.run_type}</Badge>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {startedLabel(run.started_at)}
                      </span>
                    </div>
                    <p className="mt-3 truncate text-sm font-semibold">
                      {run.market_key ?? "No market"}
                      {run.category_key ? (
                        <span className="text-muted-foreground"> / {run.category_key}</span>
                      ) : null}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">Found</p>
                        <p className="font-semibold tabular-nums">{run.discovered_count}</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">Skipped</p>
                        <p className="font-semibold tabular-nums">{run.skipped_known_count}</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">Done</p>
                        <p className="font-semibold tabular-nums">{run.enriched_count}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
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
                          {run.market_key ?? "-"}
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
                          {startedLabel(run.started_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
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
