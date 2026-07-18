"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import {
  ChevronDown,
  Coins,
  Flame,
  Globe,
  Layers,
  MapPin,
} from "lucide-react";
import {
  AnimatedNumber,
  LiveDot,
  Odometer,
  SlideIn,
  TypingDots,
} from "@/components/animated";
import { ProviderRail, RunContextBar } from "@/components/runs/run-context-bar";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisibilityInterval } from "@/hooks/use-visibility-interval";
import { FIRECRAWL_CREDIT_USD } from "@/lib/cost-budget";
import { timelineLeadIsDone } from "@/lib/pipeline/stages";
import type { RunDetailResponse } from "@/lib/run-detail-payload";
import type {
  RunCostProvider,
  RunDetail,
} from "@/lib/types";
import { cn, formatCostUnits, formatProvider, formatUsd, formatUsdPrecise } from "@/lib/utils";

const RunPipelinePanel = dynamic(
  () =>
    import("@/components/pipeline/run-pipeline-panel").then((m) => m.RunPipelinePanel),
  {
    ssr: false,
    loading: () => <Skeleton className="min-h-[28rem] w-full rounded-2xl" />,
  },
);

const PROVIDER_ICONS: Record<string, typeof Flame> = {
  firecrawl: Flame,
  browser_use: Globe,
  google_places: MapPin,
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Deterministic UTC stamp — avoids SSR/client locale hydration mismatches. */
function formatTs(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 16).replace("T", " ");
  const month = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  let hour = d.getUTCHours();
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${month} ${day} at ${hour}:${minute} ${period} UTC`;
}

function ProviderCostCard({
  group,
  share,
  index,
}: {
  group: RunCostProvider;
  share: number;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const Icon = PROVIDER_ICONS[group.provider] ?? Globe;

  return (
    <SlideIn delay={index * 0.06}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="panel overflow-hidden rounded-xl border border-border/50">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-primary/20 bg-primary/10 text-primary">
                <Icon className="size-4" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{formatProvider(group.provider)}</p>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    <Odometer value={group.usdTotal} format={formatUsd} climbSeconds={1.4} />
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(share * 100, 2)}%` }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {group.eventCount} call{group.eventCount === 1 ? "" : "s"} ·{" "}
                  {formatCostUnits(group.provider, group.unitsTotal, group.unitType)} ·{" "}
                  {(share * 100).toFixed(0)}% of run
                </p>
              </div>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-1.5 border-t border-border/50 px-4 py-3">
              {group.operations.map((op) => (
                <div
                  key={`${op.operation}-${op.unitType}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/50 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium capitalize">
                      {op.operation.replace(/_/g, " ")}
                    </span>
                    <Badge
                      variant={op.billing === "verified" ? "success" : "secondary"}
                      className="text-[10px]"
                    >
                      {op.billing === "verified" ? "Verified" : "Estimated"}
                    </Badge>
                    <span className="text-muted-foreground">
                      {op.count}× · {formatCostUnits(group.provider, op.units, op.unitType)}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono font-semibold tabular-nums">
                    {formatUsdPrecise(op.usd)}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </SlideIn>
  );
}

function RunCostSummary({
  costs,
  running,
}: {
  costs: RunDetail["costs"];
  running: boolean;
}) {
  const creditUsdEst = costs.firecrawlCreditsEst * FIRECRAWL_CREDIT_USD;

  if (costs.eventCount === 0 && costs.firecrawlCreditsEst === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        {running ? (
          <>
            <TypingDots className="text-primary" />
            Cost totals will start climbing here as each place finishes processing.
          </>
        ) : (
          "No cost events recorded for this run."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <div
          className={cn(
            "panel min-w-0 space-y-1 rounded-xl border border-border/50 p-4",
            running && "border-warning/40 shadow-[0_0_24px_-12px_rgba(255,180,60,0.55)]",
          )}
        >
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total recorded
            {running ? <LiveDot tone="warning" /> : null}
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums">
            <Odometer value={costs.totalUsd} format={formatUsd} climbSeconds={2.4} />
          </p>
          <p className="text-xs text-muted-foreground">
            <AnimatedNumber value={costs.eventCount} /> tool call
            {costs.eventCount === 1 ? "" : "s"}
            {costs.leadCount > 0 ? (
              <>
                {" · "}
                <AnimatedNumber value={costs.leadCount} /> lead(s)
              </>
            ) : null}
          </p>
        </div>
        <div className="panel min-w-0 space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verified
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums text-success">
            <Odometer value={costs.verifiedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">API-reported spend</p>
        </div>
        <div className="panel min-w-0 space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estimated
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums">
            <Odometer value={costs.estimatedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">Map/search credit fallbacks</p>
        </div>
        {costs.firecrawlCreditsEst > 0 ? (
          <div className="panel min-w-0 space-y-1 rounded-xl border border-border/50 p-4">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Coins className="size-3" />
              Credits est.
            </p>
            <p className="font-mono text-2xl font-bold leading-none tabular-nums text-warning">
              <Odometer value={costs.firecrawlCreditsEst} climbSeconds={1.8} />
            </p>
            <p className="text-xs text-muted-foreground">
              {formatUsdPrecise(creditUsdEst)} at configured Firecrawl rate
            </p>
          </div>
        ) : null}
      </div>

      {costs.byProvider.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Audit by provider — every dollar traced to its tool calls
          </p>
          {costs.byProvider.map((group, i) => (
            <ProviderCostCard
              key={group.provider}
              group={group}
              share={costs.totalUsd > 0 ? group.usdTotal / costs.totalUsd : 0}
              index={i}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function detailFingerprint(data: RunDetailResponse): string {
  const r = data.run;
  const leadSignal = data.timeline.leads
    .map((lead) => {
      const lastStage = lead.stages[lead.stages.length - 1];
      return [
        lead.place_id,
        timelineLeadIsDone(lead) ? "1" : "0",
        lead.business_name ?? "",
        lead.stages.length,
        lead.creditsEst,
        lastStage?.stage ?? "",
        lastStage?.created_at ?? "",
      ].join(":");
    })
    .join(",");
  const runEventSignal = data.timeline.runEvents
    .map((event) => `${event.stage}:${event.created_at}`)
    .join(",");
  const costSignal = data.costs.byProvider
    .map((group) => `${group.provider}:${group.eventCount}:${group.usdTotal}:${group.unitsTotal}`)
    .join(",");
  return [
    r.status,
    r.finished_at ?? r.started_at,
    r.discovered_count,
    r.skipped_known_count,
    r.enriched_count,
    data.costs.eventCount,
    data.costs.totalUsd,
    data.costs.firecrawlCreditsEst,
    costSignal,
    data.timeline.runEvents.length,
    data.timeline.leads.length,
    runEventSignal,
    leadSignal,
    data.liveJobId ?? "",
    data.liveJobStatus ?? "",
  ].join("|");
}

const MAX_TERMINAL_STAGE_REFRESHES = 12;

function hasTimelineContent(timeline: RunDetail["timeline"]): boolean {
  return timeline.runEvents.length > 0 || timeline.leads.length > 0;
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "cancelled" ||
    status === "firecrawl_credits_exhausted"
  );
}

export function RunDetailContent({
  runId,
  initialDetail = null,
  onRunFinished,
}: {
  runId: string;
  initialDetail?: RunDetailResponse | null;
  onRunFinished?: () => void;
}) {
  const [detail, setDetail] = useState<RunDetailResponse | null>(initialDetail);
  const [loading, setLoading] = useState(!initialDetail);
  const [liveJobId, setLiveJobId] = useState<string | null>(initialDetail?.liveJobId ?? null);
  const [pollIssue, setPollIssue] = useState(false);
  const [terminalPollCount, setTerminalPollCount] = useState(0);
  const [repairingOrphan, setRepairingOrphan] = useState(false);

  const loadDetail = useCallback(async (): Promise<RunDetailResponse | null | "gone"> => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (res.status === 404) return "gone";
      if (!res.ok) return null;
      return (await res.json()) as RunDetailResponse;
    } catch {
      return null;
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setTerminalPollCount(0);
    if (initialDetail && initialDetail.run.run_id === runId) {
      setDetail(initialDetail);
      setLiveJobId(initialDetail.liveJobId ?? null);
      setLoading(false);
      setPollIssue(false);
      return;
    }
    setLoading(true);

    void loadDetail()
      .then((data) => {
        if (cancelled) return;
        if (data === "gone") {
          setDetail(null);
          setLiveJobId(null);
          setPollIssue(false);
          return;
        }
        if (!data) {
          setPollIssue(true);
          return;
        }
        setPollIssue(false);
        setDetail(data);
        setLiveJobId(data.liveJobId ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadDetail, runId, initialDetail]);

  const running =
    detail?.run.status === "running" && !detail.orphanedRunning;
  // Keep polling while the parent local job is still live even if this cell
  // looks orphaned — otherwise Studio freezes mid-campaign.
  const jobStillLive =
    detail?.liveJobStatus === "running" || detail?.liveJobStatus === "pending";
  const terminalNeedsHydration = Boolean(
    detail && isTerminalStatus(detail.run.status) && !hasTimelineContent(detail.timeline),
  );
  const shouldPollWhileTerminal =
    terminalNeedsHydration && terminalPollCount < MAX_TERMINAL_STAGE_REFRESHES;

  const pollDetail = useCallback(() => {
    void loadDetail().then((data) => {
      // Run was deleted / never existed — drop zombie RUNNING UI immediately.
      if (data === "gone") {
        setDetail(null);
        setLiveJobId(null);
        setPollIssue(false);
        return;
      }
      if (!data) {
        setPollIssue(true);
        return;
      }
      setPollIssue(false);
      let becameTerminal = false;
      setDetail((prev) => {
        if (prev && !isTerminalStatus(prev.run.status) && isTerminalStatus(data.run.status)) {
          becameTerminal = true;
        }
        if (!prev || detailFingerprint(prev) !== detailFingerprint(data)) {
          return data;
        }
        return prev;
      });
      if (!isTerminalStatus(data.run.status) || hasTimelineContent(data.timeline)) {
        setTerminalPollCount(0);
      } else {
        setTerminalPollCount((count) =>
          Math.min(count + 1, MAX_TERMINAL_STAGE_REFRESHES + 1),
        );
      }
      // Drop job attach once the run (and local job) are no longer live.
      const jobStillLive =
        data.liveJobStatus === "running" || data.liveJobStatus === "pending";
      setLiveJobId(
        data.run.status === "running" || jobStillLive ? (data.liveJobId ?? null) : null,
      );
      if (becameTerminal) onRunFinished?.();
    });
  }, [loadDetail, onRunFinished]);

  useVisibilityInterval(
    pollDetail,
    2000,
    Boolean(running || jobStillLive || shouldPollWhileTerminal),
  );

  const liveCounts = useMemo(() => {
    const leads = detail?.timeline.leads ?? [];
    return {
      seen: leads.length,
      done: leads.filter((l) => timelineLeadIsDone(l)).length,
    };
  }, [detail]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Run not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No record for this run id in the database. It may have been cleaned up
          after a restart (stale RUNNING tabs will clear themselves).
        </p>
      </div>
    );
  }

  const discoveredLive = detail.liveDiscovered ?? null;
  const attachedJobId = liveJobId ?? detail.liveJobId ?? null;
  const orphanedRunning = Boolean(detail.orphanedRunning);

  return (
    <div className="flex min-w-0 w-full max-w-full flex-col gap-4 overflow-x-hidden">
      <RunContextBar
        run={detail.run}
        costs={detail.costs}
        liveJobId={attachedJobId}
        liveJobStatus={detail.liveJobStatus}
        orphanedRunning={orphanedRunning}
        repairingOrphan={repairingOrphan}
        onRepairOrphan={() => {
          setRepairingOrphan(true);
          void fetch(`/api/runs/${encodeURIComponent(runId)}/repair`, {
            method: "POST",
          })
            .then((res) => res.json())
            .then(() => loadDetail())
            .then((data) => {
              if (data && data !== "gone") setDetail(data);
            })
            .finally(() => setRepairingOrphan(false));
        }}
        executionMode="local"
        verifiedDmCount={detail.run.verified_dm_count}
      />

      <div className="min-w-0 w-full max-w-full space-y-8">
        <div className="min-w-0 space-y-2">
          <ProviderRail costs={detail.costs} />
          <p className="font-mono text-[11px] text-muted-foreground">
            Started {formatTs(detail.run.started_at)}
            {detail.run.finished_at
              ? ` · Finished ${formatTs(detail.run.finished_at)}`
              : running
                ? " · In progress"
                : ""}
            {" · "}
            {running ? (
              <>
                {discoveredLive !== null ? `${discoveredLive} discovered · ` : ""}
                {liveCounts.done}/{liveCounts.seen} leads processed so far
                {pollIssue ? " · reconnecting telemetry" : ""}
              </>
            ) : (
              <>
                {detail.run.discovered_count} discovered · {detail.run.skipped_known_count}{" "}
                skipped · {detail.run.enriched_count} completed
              </>
            )}
          </p>
        </div>

        <section className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="size-3.5" />
            Pipeline Studio
            {running ? <LiveDot tone="primary" /> : null}
          </h3>
          {detail ? (
            <RunPipelinePanel
              key={runId}
              runId={runId}
              status={
                // Orphaned RUNNING rows must not keep Studio in live mode.
                running
                  ? "running"
                  : detail.orphanedRunning && detail.run.status === "running"
                    ? "interrupted"
                    : detail.run.status
              }
              startedAt={detail.run.started_at}
              finishedAt={detail.run.finished_at}
              initialStudio={{
                events: detail.studioEvents ?? [],
                costs: detail.studioCosts ?? [],
              }}
              runTimeline={detail.timeline}
              liveNames={detail.liveNames}
            />
          ) : (
            <Skeleton className="min-h-[28rem] w-full rounded-2xl" />
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="font-mono text-[11px] font-semibold normal-case tracking-normal text-muted-foreground" aria-hidden>
              $
            </span>
            Run cost summary
            {running ? (
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                — climbing live as costs queue in
              </span>
            ) : null}
          </h3>
          <RunCostSummary costs={detail.costs} running={running} />
        </section>
      </div>
    </div>
  );
}
