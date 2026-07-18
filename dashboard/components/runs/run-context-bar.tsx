"use client";

import Link from "next/link";
import { Database, Timer } from "lucide-react";
import { LiveDot } from "@/components/animated";
import { CancelJobButton } from "@/components/cancel-job-button";
import { RunStatusBadge, StopReasonBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { JobExecutionMode, RunDetail } from "@/lib/types";
import { formatCredits, formatUsd, cn } from "@/lib/utils";

function elapsedLabel(startedAt: string, finishedAt: string | null): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "—";
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const ms = Math.max(0, end - start);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function RunContextBar({
  run,
  costs,
  liveJobId,
  liveJobStatus,
  orphanedRunning,
  onRepairOrphan,
  repairingOrphan,
  executionMode = "local",
  verifiedDmCount,
  className,
}: {
  run: RunDetail["run"];
  costs: RunDetail["costs"];
  liveJobId?: string | null;
  liveJobStatus?: string | null;
  orphanedRunning?: boolean;
  onRepairOrphan?: () => void;
  repairingOrphan?: boolean;
  executionMode?: JobExecutionMode;
  verifiedDmCount?: number | null;
  className?: string;
}) {
  const running = run.status === "running";
  const jobLive =
    liveJobStatus === "running" || liveJobStatus === "pending";
  const showCancel = Boolean(liveJobId && jobLive && running && !orphanedRunning);
  const marketFilter = run.market_key
    ? `/data?market=${encodeURIComponent(run.market_key)}`
    : "/data";

  return (
    <div
      data-testid="run-context-bar"
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-card px-6 py-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <StopReasonBadge
              reason={run.stop_reason}
              detail={run.stop_detail ?? run.error}
              status={run.status}
              discoveredCount={run.discovered_count}
            />
            <Badge variant="outline">{run.run_type}</Badge>
            {run.campaign_key ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {run.campaign_key}
              </Badge>
            ) : null}
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              Execution · {executionMode}
            </Badge>
            {running && !orphanedRunning ? <LiveDot tone="warning" /> : null}
            {orphanedRunning ? (
              <Badge variant="warning" className="font-mono text-[10px] uppercase">
                Orphaned / stale
              </Badge>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold leading-snug">
            {[run.market_key, run.category_key].filter(Boolean).join(" / ") || run.run_type}
          </h1>
          {orphanedRunning ? (
            <p className="max-w-3xl text-xs text-muted-foreground">
              DB still says running, but the parent local job is already{" "}
              <span className="font-mono">{liveJobStatus ?? "finished"}</span>.
              Repair marks this cell cancelled so Run history matches Launch.
            </p>
          ) : null}
          {run.stop_detail || run.error ? (
            <p
              className="max-w-3xl font-mono text-[11px] leading-relaxed text-destructive/90"
              title={run.error ?? run.stop_detail ?? undefined}
            >
              {run.stop_detail ?? run.error?.split("\n")[0]}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Timer className="size-3" />
              {elapsedLabel(run.started_at, run.finished_at)}
            </span>
            <span>
              {formatCredits(costs.firecrawlCreditsEst)} cr · {formatUsd(costs.totalUsd)}
            </span>
            {verifiedDmCount != null ? <span>{verifiedDmCount} verified DMs</span> : null}
            <span className="truncate">{run.run_id}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveJobId ? <CancelJobButton jobId={liveJobId} visible={showCancel} /> : null}
          {orphanedRunning && onRepairOrphan ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={repairingOrphan}
              onClick={onRepairOrphan}
            >
              {repairingOrphan ? "Repairing…" : "Mark cancelled"}
            </Button>
          ) : null}
          {liveJobId ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/runs?job=${encodeURIComponent(liveJobId)}`}>Job cells</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={marketFilter}>
              <Database className="size-3.5" />
              Data
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProviderRail({
  costs,
}: {
  costs: RunDetail["costs"];
}) {
  const providers = ["google_places", "firecrawl"] as const;
  const seen = new Set(costs.byProvider.map((p) => p.provider));
  return (
    <div
      data-testid="provider-rail"
      className="flex flex-wrap gap-2 rounded-xl border border-border/50 bg-card px-3 py-2"
    >
      {providers.map((provider) => {
        const active = seen.has(provider);
        const group = costs.byProvider.find((p) => p.provider === provider);
        return (
          <Badge
            key={provider}
            variant={active ? "default" : "outline"}
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.08em]",
              !active && "opacity-50",
            )}
          >
            {provider.replace(/_/g, " ")}
            {group ? ` · ${formatUsd(group.usdTotal)}` : ""}
          </Badge>
        );
      })}
    </div>
  );
}
