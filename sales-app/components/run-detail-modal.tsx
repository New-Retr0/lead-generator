"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCostUnits, formatProvider, formatUsd } from "@/lib/utils";
import type {
  RunCostProvider,
  RunDetail,
  RunTimelineLead,
  RunTimelineStage,
} from "@/lib/types";

type RunDetailResponse = RunDetail & {
  liveJobId?: string | null;
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
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/85 to-[oklch(0.55_0.16_290)] text-white shadow-[0_4px_14px_-4px_oklch(0.5_0.19_262/0.6)]">
              <Building2 className="size-3.5" strokeWidth={2.25} />
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
                {typeof lead.lead_score === "number" ? ` · ${lead.lead_score}` : ""}
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
        <div className="rounded-lg border border-border bg-card">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Icon className="size-4" strokeWidth={2} />
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
                    {formatUsd(op.usd)}
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
  const creditUsdEst = costs.firecrawlCreditsEst * 0.00533;

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className={cn(
            "space-y-1 rounded-lg border border-border bg-card p-4",
            running && "border-warning/40 shadow-[0_0_24px_-12px_oklch(0.78_0.16_75/0.8)]",
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
        <div className="space-y-1 rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verified
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums text-success">
            <Odometer value={costs.verifiedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">API-reported spend</p>
        </div>
        <div className="space-y-1 rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estimated
          </p>
          <p className="font-mono text-2xl font-bold leading-none tabular-nums">
            <Odometer value={costs.estimatedUsd} format={formatUsd} climbSeconds={1.8} />
          </p>
          <p className="text-xs text-muted-foreground">Map/search credit fallbacks</p>
        </div>
        {costs.firecrawlCreditsEst > 0 ? (
          <div className="space-y-1 rounded-lg border border-border bg-card p-4">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Coins className="size-3" />
              Credits est.
            </p>
            <p className="font-mono text-2xl font-bold leading-none tabular-nums text-warning">
              <Odometer value={costs.firecrawlCreditsEst} climbSeconds={1.8} />
            </p>
            <p className="text-xs text-muted-foreground">
              {formatUsd(creditUsdEst)} at Hobby rate
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
      <div className={cn("space-y-2", running && "rounded-lg border border-border bg-card p-3")}>
        {running ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Building2 className="size-3" />
                Leads
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">
                <AnimatedNumber value={stats.done} />
                <span className="text-xs font-medium text-muted-foreground"> / {stats.total}</span>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Layers className="size-3" />
                Stages
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">
                <AnimatedNumber value={stats.stages} />
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
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

        {timeline.runEvents.length > 0 ? (
          <div className="space-y-0.5 rounded-lg border border-border bg-card px-1.5 py-1.5">
            {timeline.runEvents.map((stage, i) => (
              <StageRow key={`run-${stage.stage}-${stage.created_at}-${i}`} stage={stage} />
            ))}
          </div>
        ) : null}
        {timeline.leads.map((lead, i) => {
          const inFlight = running && !lead.done;
          return (
            <LeadTimelineCard
              key={lead.place_id}
              lead={lead}
              resolvedName={liveNames?.[lead.place_id] ?? null}
              inFlight={inFlight}
              defaultOpen={inFlight || i === timeline.leads.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function RunDetailContent({
  runId,
  onRunFinished,
}: {
  runId: string;
  onRunFinished?: () => void;
}) {
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    return (await res.json()) as RunDetailResponse;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setLoading(true);

    void loadDetail()
      .then((data) => {
        if (cancelled || !data) return;
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

  useEffect(() => {
    if (!running) return;

    const interval = window.setInterval(() => {
      void loadDetail().then((data) => {
        if (!data) return;
        setDetail(data);
        if (data.liveJobId) setLiveJobId(data.liveJobId);
      });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [running, loadDetail]);

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
      <div className="space-y-4 p-4 sm:p-6">
        <DialogTitle className="sr-only">Loading run details</DialogTitle>
        <DialogDescription className="sr-only">
          Fetching run progress and cost summary.
        </DialogDescription>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-4 sm:p-6">
        <DialogTitle className="text-lg">Run not found</DialogTitle>
        <DialogDescription className="mt-2">
          No record for this run id in the database.
        </DialogDescription>
      </div>
    );
  }

  const discoveredLive = detail.liveDiscovered ?? null;

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 pr-12 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={detail.run.status} />
              <Badge variant="outline">{detail.run.run_type}</Badge>
              {running ? <LiveDot tone="warning" /> : null}
            </div>
            <DialogTitle className="text-lg font-semibold leading-snug sm:text-xl">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm">
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
            </DialogDescription>
          </div>
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {detail.run.run_id}
          </p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4 sm:space-y-8 sm:p-6">
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <SquareTerminal className="size-3.5" />
              {running && liveJobId ? "Live run" : "Run progress"}
              {running && !liveJobId ? <LiveDot tone="primary" /> : null}
            </h3>
            {running && liveJobId ? (
              <JobTimeline
                jobId={liveJobId}
                onDone={() => {
                  void loadDetail().then((data) => {
                    if (data) {
                      setDetail(data);
                      setLiveJobId(null);
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

          {running && liveJobId && detail.timeline.leads.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Stage audit (persisted)
              </h3>
              <PersistedTimeline
                timeline={detail.timeline}
                running={running}
                liveNames={detail.liveNames}
              />
            </section>
          ) : null}

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

export function RunDetailModal({
  runId,
  onClose,
  onRunFinished,
}: {
  runId: string | null;
  onClose: () => void;
  onRunFinished?: () => void;
}) {
  return (
    <Dialog open={Boolean(runId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton
        className="top-0 flex h-svh w-full max-w-none translate-x-[-50%] translate-y-0 flex-col gap-0 overflow-hidden rounded-none border border-border bg-card p-0 shadow-lg sm:top-6 sm:h-[calc(100vh-3rem)] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-lg"
      >
        {runId ? (
          <RunDetailContent runId={runId} onRunFinished={onRunFinished} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
