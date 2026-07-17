"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import {
  Building2,
  ChevronDown,
  Coins,
  DollarSign,
  Flame,
  Globe,
  Layers,
  MapPin,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import {
  AnimatedNumber,
  LiveDot,
  Odometer,
  SlideIn,
  TypingDots,
} from "@/components/animated";
import { RunStatusBadge } from "@/components/badges";
import { JobTimeline } from "@/components/job-timeline";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCostUnits, formatProvider, formatUsd, formatUsdPrecise } from "@/lib/utils";
import { FIRECRAWL_CREDIT_USD } from "@/lib/cost-budget";
import type {
  RunCostProvider,
  RunDetail,
  RunTimelineLead,
  RunTimelineStage,
} from "@/lib/types";

const RunPipelinePanel = dynamic(
  () =>
    import("@/components/pipeline/run-pipeline-panel").then((m) => m.RunPipelinePanel),
  {
    ssr: false,
    loading: () => <Skeleton className="h-96 w-full rounded-lg" />,
  },
);

type RunDetailResponse = RunDetail & {
  liveJobId?: string | null;
  liveJobStatus?: string | null;
  liveJobFinishedAt?: string | null;
  liveNames?: Record<string, string>;
  liveDiscovered?: number | null;
};

const PROVIDER_ICONS: Record<string, typeof Flame> = {
  firecrawl: Flame,
  browser_use: Globe,
  ai_gateway: Sparkles,
  google_places: MapPin,
};

function formatStageLabel(stage: string): string {
  if (stage.startsWith("source_check:")) {
    return `Source: ${stage.replace("source_check:", "")}`;
  }
  return stage.replace(/_/g, " ");
}

function formatTs(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StageRow({ stage, active }: { stage: RunTimelineStage; active?: boolean }) {
  const tone = stage.ran
    ? "border-primary/40 bg-primary/12 text-primary"
    : "border-border bg-muted/50 text-muted-foreground";
  const chipClass = cn(
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase",
    tone,
  );

  return (
    <SlideIn>
      <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent/40">
        {active ? (
          <motion.span
            className={chipClass}
            animate={{ scale: [1, 1.18, 1], opacity: [1, 0.8, 1] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          >
            {stage.ran ? "✓" : "—"}
          </motion.span>
        ) : (
          <span className={chipClass}>{stage.ran ? "✓" : "—"}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium capitalize leading-snug">
            {formatStageLabel(stage.stage)}
          </p>
          {stage.reason ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{stage.reason}</p>
          ) : null}
        </div>
        {typeof stage.credits_est === "number" && stage.credits_est > 0 ? (
          <span className="mt-0.5 shrink-0 rounded-full border border-warning/30 bg-warning/8 px-2 py-0.5 font-mono text-[10px] tabular-nums text-warning">
            {stage.credits_est} cr
          </span>
        ) : null}
      </div>
    </SlideIn>
  );
}

function WorkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/12 text-primary">
        <TypingDots />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function LeadTimelineCard({
  lead,
  resolvedName,
  inFlight,
  defaultOpen,
}: {
  lead: RunTimelineLead;
  resolvedName: string | null;
  inFlight: boolean;
  defaultOpen: boolean;
}) {
  const name = lead.business_name ?? resolvedName;
  const shortId = lead.place_id.replace(/^places\//, "").slice(-6);

  return (
    <SlideIn>
      <Collapsible defaultOpen={defaultOpen}>
        <div className="glass overflow-hidden rounded-xl">
          <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-primary/20 bg-primary/10 text-primary">
              <Building2 className="size-3.5" strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold leading-tight">
                <span className="truncate">
                  {name ?? (inFlight ? "Processing lead…" : "Unnamed lead")}
                </span>
                {!name ? (
                  <span className="shrink-0 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                    …{shortId}
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {lead.stages.length} stage{lead.stages.length === 1 ? "" : "s"}
                {lead.creditsEst > 0 ? ` · ~${lead.creditsEst} cr est.` : ""}
              </span>
            </span>
            {inFlight ? (
              <LiveDot tone="primary" className="shrink-0" />
            ) : lead.verification_level ? (
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                {lead.verification_level}
              </Badge>
            ) : null}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-data-[state=open]/trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-0.5 border-t border-border/40 px-1.5 py-1.5">
              {lead.stages.map((stage, i) => (
                <StageRow
                  key={`${stage.stage}-${stage.created_at}-${i}`}
                  stage={stage}
                  active={inFlight && i === lead.stages.length - 1}
                />
              ))}
              {inFlight ? <WorkingRow label="working — next stage streaming in…" /> : null}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </SlideIn>
  );
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
        <div className="glass rounded-xl border border-border/50">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30"
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
                    className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.6_0.16_300)]"
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
      <motion.div
        layout
        className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {running ? (
          <>
            <TypingDots className="text-primary" />
            Cost totals will start climbing here as each place finishes processing.
          </>
        ) : (
          "No cost events recorded for this run."
        )}
      </motion.div>
    );
  }

  return (
    <motion.div layout className="space-y-4" transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
      <motion.div layout className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div
          layout
          className={cn(
            "glass space-y-1 rounded-xl border border-border/50 p-4",
            running && "border-warning/40 shadow-[0_0_24px_-12px_oklch(0.78_0.16_75/0.8)]",
          )}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
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
        </motion.div>
        <motion.div layout className="glass space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verified
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums text-success">
            <Odometer value={costs.verifiedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">API-reported spend</p>
        </motion.div>
        <motion.div layout className="glass space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estimated
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums">
            <Odometer value={costs.estimatedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">Map/search credit fallbacks</p>
        </motion.div>
        {costs.firecrawlCreditsEst > 0 ? (
          <motion.div layout className="glass space-y-1 rounded-xl border border-border/50 p-4">
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
          </motion.div>
        ) : null}
      </motion.div>

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
    </motion.div>
  );
}

function PersistedTimeline({
  timeline,
  running,
  liveNames,
}: {
  timeline: RunDetail["timeline"];
  running: boolean;
  liveNames?: Record<string, string>;
}) {
  const stats = useMemo(() => {
    const done = timeline.leads.filter((l) => l.done).length;
    const stages =
      timeline.leads.reduce((n, l) => n + l.stages.length, 0) + timeline.runEvents.length;
    const credits = timeline.leads.reduce((n, l) => n + l.creditsEst, 0);
    return { done, total: timeline.leads.length, stages, credits };
  }, [timeline]);

  const hasContent = timeline.runEvents.length > 0 || timeline.leads.length > 0;
  const visibleRunEvents = running ? timeline.runEvents.slice(-4) : timeline.runEvents;
  const visibleLeads = running ? timeline.leads.slice(-4) : timeline.leads;
  const hiddenActivityCount =
    timeline.runEvents.length - visibleRunEvents.length +
    timeline.leads.length - visibleLeads.length;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {running ? (
          <>
            <TypingDots className="text-primary" />
            Waiting for the first stages to land in the database…
          </>
        ) : (
          "No persisted stage events for this run."
        )}
      </div>
    );
  }

  return (
    <div className={cn(running && "live-ring rounded-2xl p-px")}>
      <div className={cn("space-y-2", running && "glass-strong rounded-2xl p-3")}>
        {running ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="glass rounded-xl px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Building2 className="size-3" />
                Leads
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">
                <AnimatedNumber value={stats.done} />
                <span className="text-xs font-medium text-muted-foreground"> / {stats.total}</span>
              </p>
            </div>
            <div className="glass rounded-xl px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Layers className="size-3" />
                Stages
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">
                <AnimatedNumber value={stats.stages} />
              </p>
            </div>
            <div className="glass rounded-xl px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Coins className="size-3" />
                Credits est.
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none tabular-nums text-warning">
                <Odometer value={stats.credits} climbSeconds={1.4} />
              </p>
            </div>
          </div>
        ) : null}

        {visibleRunEvents.length > 0 ? (
          <div className="glass space-y-0.5 rounded-xl px-1.5 py-1.5">
            {visibleRunEvents.map((stage, i) => (
              <StageRow key={`run-${stage.stage}-${stage.created_at}-${i}`} stage={stage} />
            ))}
          </div>
        ) : null}
        {visibleLeads.map((lead, i) => {
          const inFlight = running && !lead.done;
          return (
            <LeadTimelineCard
              key={lead.place_id}
              lead={lead}
              resolvedName={liveNames?.[lead.place_id] ?? null}
              inFlight={inFlight}
              defaultOpen={inFlight || i === visibleLeads.length - 1}
            />
          );
        })}
        {running && hiddenActivityCount > 0 ? (
          <p className="px-2 pb-1 text-center text-[11px] text-muted-foreground">
            Showing latest activity - {hiddenActivityCount} earlier item
            {hiddenActivityCount === 1 ? "" : "s"} tucked away.
          </p>
        ) : null}
      </div>
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
        lead.done ? "1" : "0",
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
    status === "cancelled"
  );
}

export function RunDetailContent({
  runId,
  onRunFinished,
}: {
  runId: string;
  onRunFinished?: () => void;
}) {
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [pollIssue, setPollIssue] = useState(false);
  const [terminalPollCount, setTerminalPollCount] = useState(0);

  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as RunDetailResponse;
    } catch {
      return null;
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setLoading(true);
    setTerminalPollCount(0);

    void loadDetail()
      .then((data) => {
        if (cancelled || !data) {
          if (!cancelled) setPollIssue(true);
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
  }, [loadDetail]);

  const running = detail?.run.status === "running";
  const terminalNeedsHydration = Boolean(
    detail && isTerminalStatus(detail.run.status) && !hasTimelineContent(detail.timeline),
  );
  const shouldPollWhileTerminal =
    terminalNeedsHydration && terminalPollCount < MAX_TERMINAL_STAGE_REFRESHES;

  useEffect(() => {
    if (!running && !shouldPollWhileTerminal) return;

    const interval = window.setInterval(() => {
      void loadDetail().then((data) => {
        if (!data) {
          setPollIssue(true);
          return;
        }
        setPollIssue(false);
        setDetail((prev) => {
          if (!prev || detailFingerprint(prev) !== detailFingerprint(data)) {
            return data;
          }
          return prev;
        });
        if (!isTerminalStatus(data.run.status) || hasTimelineContent(data.timeline)) {
          if (terminalPollCount !== 0) {
            setTerminalPollCount(0);
          }
        } else {
          const next = Math.min(
            terminalPollCount + 1,
            MAX_TERMINAL_STAGE_REFRESHES + 1,
          );
          setTerminalPollCount(next);
          if (next >= MAX_TERMINAL_STAGE_REFRESHES) {
            window.clearInterval(interval);
          }
        }
        setLiveJobId((prev) => data.liveJobId ?? (data.run.status === "running" ? prev : null));
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [running, shouldPollWhileTerminal, loadDetail, terminalPollCount]);

  const title = useMemo(() => {
    if (!detail) return "Run details";
    const parts = [detail.run.market_key, detail.run.category_key].filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : detail.run.run_type;
  }, [detail]);

  const liveCounts = useMemo(() => {
    const leads = detail?.timeline.leads ?? [];
    return {
      seen: leads.length,
      done: leads.filter((l) => l.done).length,
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
          No record for this run id in the database.
        </p>
      </div>
    );
  }

  const discoveredLive = detail.liveDiscovered ?? null;
  const attachedJobId = liveJobId ?? detail.liveJobId ?? null;
  const attachedJobTerminal =
    detail.liveJobStatus === "failed" ||
    detail.liveJobStatus === "interrupted" ||
    detail.liveJobStatus === "cancelled" ||
    detail.liveJobStatus === "completed";
  const showJobTimeline = Boolean(attachedJobId) && (running || attachedJobTerminal);

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-6 py-4 backdrop-blur-xl supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={detail.run.status} />
              <Badge variant="outline">{detail.run.run_type}</Badge>
              {running ? <LiveDot tone="warning" /> : null}
            </div>
            <h1 className="text-xl font-semibold leading-snug">{title}</h1>
            <p className="text-sm text-muted-foreground">
              Started {formatTs(detail.run.started_at)}
              {detail.run.finished_at
                ? ` · Finished ${formatTs(detail.run.finished_at)}`
                : running
                  ? " · In progress"
                  : ""}
              {" · "}
              {running ? (
                <>
                  {discoveredLive !== null
                    ? `${discoveredLive} discovered · `
                    : ""}
                  {liveCounts.done}/{liveCounts.seen} leads processed so far
                </>
              ) : (
                <>
                  {detail.run.discovered_count} discovered · {detail.run.skipped_known_count}{" "}
                  skipped · {detail.run.enriched_count} completed
                </>
              )}
            </p>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">{detail.run.run_id}</p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-8 p-6">
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Layers className="size-3.5" />
              Pipeline replay
            </h3>
            {detail ? (
              <RunPipelinePanel
                key={runId}
                runId={runId}
                status={detail.run.status}
                startedAt={detail.run.started_at}
                finishedAt={detail.run.finished_at}
              />
            ) : (
              <Skeleton className="h-96 w-full rounded-lg" />
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <SquareTerminal className="size-3.5" />
              {showJobTimeline ? "Live run summary" : "Run progress"}
              {running && !showJobTimeline ? <LiveDot tone="primary" /> : null}
              {pollIssue ? (
                <span className="font-normal normal-case text-warning">
                  reconnecting - last good telemetry held
                </span>
              ) : null}
            </h3>
            {showJobTimeline && attachedJobId ? (
              <JobTimeline
                jobId={attachedJobId}
                compact
                onDone={() => {
                  void loadDetail().then((data) => {
                    if (data) {
                      setPollIssue(false);
                      setDetail(data);
                      setLiveJobId((prev) =>
                        data.liveJobId ?? (data.run.status === "running" ? prev : null),
                      );
                    } else {
                      setPollIssue(true);
                    }
                    onRunFinished?.();
                  });
                }}
              />
            ) : (
              <PersistedTimeline
                timeline={detail.timeline}
                running={running}
                liveNames={detail.liveNames}
              />
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <DollarSign className="size-3.5" />
              Run cost summary
              {running ? (
                <span className="font-normal normal-case text-muted-foreground">
                  — climbing live as costs queue in
                </span>
              ) : null}
            </h3>
            <RunCostSummary costs={detail.costs} running={running} />
          </section>
        </div>
      </ScrollArea>
    </>
  );
}
