"use client";

import Link from "next/link";
import {
  BarChart3,
  Brain,
  Coins,
  Target,
  TrendingUp,
} from "lucide-react";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InsightReport } from "@/lib/types";
import { formatPct, formatUsd } from "@/lib/utils";

type SegmentStat = {
  bucket: string;
  wins: number;
  total: number;
  smoothed_win_rate: number;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function SegmentTable({
  title,
  rows,
}: {
  title: string;
  rows: SegmentStat[];
}) {
  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
          {title}
        </CardTitle>
        <CardDescription>Smoothed win rate from labeled feature outcomes.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No labeled outcomes yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.slice(0, 8).map((row) => (
              <div
                key={row.bucket}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-medium">{row.bucket}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {row.wins}/{row.total} · {formatPct(row.smoothed_win_rate)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LearnPageClient({
  report,
  winRateByCategory,
  winRateByMarket,
  labeledCount,
  labelThreshold,
}: {
  report: InsightReport | null;
  winRateByCategory: SegmentStat[];
  winRateByMarket: SegmentStat[];
  labeledCount: number;
  labelThreshold: number;
}) {
  const reportJson = report?.report_json ?? {};
  const modelMetrics = report?.model_metrics ?? {};
  const costPerWin = asNumber(reportJson.cost_per_win ?? reportJson.usd_per_win);
  const calibration = asRecord(reportJson.score_calibration) ?? asRecord(modelMetrics);
  const auc = asNumber(calibration?.auc ?? modelMetrics.auc);
  const labelsToThreshold = Math.max(0, labelThreshold - labeledCount);

  return (
    <div className="space-y-8" data-testid="learn-page">
      <div className="space-y-3">
        <SectionHeading index="01" title="Learn" />
        <p className="max-w-2xl font-mono text-xs tracking-[0.08em] text-muted-foreground">
          Closed-loop intelligence from outcomes and touches — not a CRM. Feed labels from Data
          learning feedback or Partner API.
        </p>
      </div>

      <SectionReveal>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="panel">
            <CardContent className="space-y-2 py-5">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <Target className="size-3.5" />
                Labels
              </p>
              <p className="text-2xl font-semibold tabular-nums">{labeledCount}</p>
              <p className="text-xs text-muted-foreground">
                {labelsToThreshold > 0
                  ? `${labelsToThreshold} more to unlock learned score fit`
                  : "Threshold met for score fitting"}
              </p>
            </CardContent>
          </Card>
          <Card className="panel">
            <CardContent className="space-y-2 py-5">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <Brain className="size-3.5" />
                Latest report
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {report ? `#${report.id}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {report
                  ? new Date(report.created_at).toLocaleString("en-US")
                  : "Run `pallares-leads insights`"}
              </p>
            </CardContent>
          </Card>
          <Card className="panel">
            <CardContent className="space-y-2 py-5">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <TrendingUp className="size-3.5" />
                Calibration AUC
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {auc != null ? auc.toFixed(3) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">From latest insight model metrics</p>
            </CardContent>
          </Card>
          <Card className="panel">
            <CardContent className="space-y-2 py-5">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <Coins className="size-3.5" />
                Cost / win
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {costPerWin != null ? formatUsd(costPerWin) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Spend tied to labeled wins</p>
            </CardContent>
          </Card>
        </div>
      </SectionReveal>

      <SectionReveal>
        <div className="grid gap-4 lg:grid-cols-2">
          <SegmentTable title="Win rate by category" rows={winRateByCategory} />
          <SegmentTable title="Win rate by market" rows={winRateByMarket} />
        </div>
      </SectionReveal>

      <SectionReveal>
        <Card className="panel">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]">
                <BarChart3 className="size-3.5" />
                Insight report
              </CardTitle>
              <CardDescription>
                Persisted from CLI `pallares-leads insights`. Dashboard is read-only observer.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              Threshold {labelThreshold}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {report ? (
              <>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Sample {report.sample_size}</span>
                  <span>·</span>
                  <span>Labeled {report.labeled_count}</span>
                </div>
                <pre className="max-h-80 overflow-auto rounded-xl border border-border/50 bg-muted/20 p-4 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(
                    {
                      summary: {
                        sample_size: report.sample_size,
                        labeled_count: report.labeled_count,
                        cost_per_win: costPerWin,
                        auc,
                      },
                      report_keys: Object.keys(reportJson).slice(0, 24),
                      model_metrics: modelMetrics,
                    },
                    null,
                    2,
                  )}
                </pre>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No insight reports in the database yet. Generate one with the CLI once you have
                enough labeled outcomes.
              </p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/data">Open Data learning feedback</Link>
            </Button>
          </CardContent>
        </Card>
      </SectionReveal>
    </div>
  );
}
