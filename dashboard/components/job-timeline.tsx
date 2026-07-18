"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Coins,
  FileSearch,
  Globe,
  Landmark,
  Map as MapIcon,
  ScanSearch,
  Share2,
  ShieldX,
  Sparkles,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import {
  AnimatedNumber,
  LiveDot,
  Odometer,
  SlideIn,
  TypingDots,
} from "@/components/animated";
import { CancelJobButton } from "@/components/cancel-job-button";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useJobStream } from "@/hooks/use-job-stream";
import { nowLine } from "@/lib/job-activity";
import { cn } from "@/lib/utils";
import type { JobEvent } from "@/lib/types";

type StageMeta = {
  label: string;
  icon: typeof Globe;
  tone: "ok" | "warn" | "bad" | "info";
};

const STAGE_META: Record<string, StageMeta> = {
  run_started: { label: "Run started", icon: Sparkles, tone: "info" },
  lead_started: { label: "Lead started", icon: Building2, tone: "info" },
  lead_done: { label: "Lead complete", icon: CheckCircle2, tone: "ok" },
  map: { label: "Map", icon: MapIcon, tone: "info" },
  scrape_json: { label: "Scrape + JSON", icon: FileSearch, tone: "info" },
  search_contact: { label: "Search contact", icon: ScanSearch, tone: "info" },
  bbb: { label: "BBB registry", icon: Landmark, tone: "info" },
  socials: { label: "Social links", icon: Share2, tone: "info" },
  owner_chain: { label: "Owner chain", icon: Landmark, tone: "info" },
  owner_chain_skip: { label: "Owner chain skipped", icon: ShieldX, tone: "warn" },
  verification_rejected: { label: "Rejected by verification", icon: ShieldX, tone: "bad" },
  discovery_done: { label: "Places found", icon: Globe, tone: "info" },
  run_done: { label: "Run complete", icon: Sparkles, tone: "ok" },
  heartbeat: { label: "Run heartbeat", icon: Sparkles, tone: "info" },
  lead_failed: { label: "Lead failed", icon: XCircle, tone: "bad" },
};

const TONE_STYLES: Record<StageMeta["tone"], { dot: string; chip: string }> = {
  ok: {
    dot: "text-success",
    chip: "border-success/40 bg-success/15 text-success",
  },
  warn: {
    dot: "text-warning",
    chip: "border-warning/45 bg-warning/15 text-warning",
  },
  bad: {
    dot: "text-destructive",
    chip: "border-destructive/45 bg-destructive/15 text-destructive",
  },
  info: {
    dot: "text-primary",
    chip: "border-primary/40 bg-primary/12 text-primary",
  },
};

function detailFor(event: JobEvent): string {
  if (event.reason) return event.reason;
  if (event.event === "run_started") {
    return [event.market, event.category].filter(Boolean).join(" / ");
  }
  if (event.event === "discovery_done" && typeof event.count === "number") {
    return `${event.count} place(s) discovered`;
  }
  if (event.event === "run_done") {
    const parts: string[] = [];
    if (typeof event.discovered === "number") parts.push(`${event.discovered} discovered`);
    if (typeof event.skipped_known === "number" && event.skipped_known > 0) {
      parts.push(`${event.skipped_known} already known`);
    }
    if (typeof event.enriched === "number") parts.push(`${event.enriched} completed`);
    return parts.join(" · ");
  }
  return "";
}

function metaFor(event: JobEvent): StageMeta {
  const known = STAGE_META[event.event];
  if (known) return known;
  if (event.status === "failed" || event.event.includes("error")) {
    return { label: event.event, icon: XCircle, tone: "bad" };
  }
  return { label: event.event.replace(/_/g, " "), icon: Globe, tone: "info" };
}

function verificationTone(level?: string) {
  if (level === "verified") return "border-success/35 bg-success/10 text-success";
  if (level === "partial") return "border-warning/40 bg-warning/10 text-warning";
  return "border-border bg-muted/50 text-muted-foreground";
}

type LeadGroup = {
  key: string;
  business: string;
  events: JobEvent[];
  done?: JobEvent;
};

function groupByLead(events: JobEvent[]): { runEvents: JobEvent[]; leads: LeadGroup[] } {
  const runEvents: JobEvent[] = [];
  const map = new Map<string, LeadGroup>();
  for (const evt of events) {
    const key = evt.place_id ?? "";
    if (!key) {
      runEvents.push(evt);
      continue;
    }
    let group = map.get(key);
    if (!group) {
      group = { key, business: evt.business ?? key, events: [] };
      map.set(key, group);
    }
    if (evt.business) group.business = evt.business;
    group.events.push(evt);
    if (evt.event === "lead_done") group.done = evt;
  }
  return { runEvents, leads: [...map.values()] };
}

const EventRow = memo(function EventRow({
  event,
  active,
}: {
  event: JobEvent;
  active?: boolean;
}) {
  const meta = metaFor(event);
  const tone = TONE_STYLES[meta.tone];
  const Icon = meta.icon;
  const chipClass = cn(
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border",
    tone.chip,
  );
  return (
    <SlideIn>
      <div className="group/row flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent">
        {active ? (
          <motion.span
            className={chipClass}
            animate={{ scale: [1, 1.18, 1], opacity: [1, 0.8, 1] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon className="size-3.5" strokeWidth={2.25} />
          </motion.span>
        ) : (
          <span className={chipClass}>
            <Icon className="size-3.5" strokeWidth={2.25} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug">
            {meta.label}
            {event.stage && event.stage !== event.event ? (
              <span className="text-muted-foreground"> · {event.stage}</span>
            ) : null}
          </p>
          {event.event === "verification_rejected" && event.value ? (
            <p className="mt-0.5 text-xs text-destructive">
              ✕ rejected invented {event.kind ?? "value"}{" "}
              <span className="font-mono">&ldquo;{event.value}&rdquo;</span>
            </p>
          ) : detailFor(event) ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {detailFor(event)}
            </p>
          ) : null}
        </div>
        {typeof event.credits === "number" && event.credits > 0 ? (
          <span className="mt-0.5 shrink-0 rounded-full border border-warning/30 bg-warning/8 px-2 py-0.5 font-mono text-[10px] tabular-nums text-warning">
            {event.credits} cr
          </span>
        ) : null}
      </div>
    </SlideIn>
  );
});

const LeadGroupCard = memo(function LeadGroupCard({
  group,
  defaultOpen,
  nowMs,
  streamRunning,
  compact = false,
}: {
  group: LeadGroup;
  defaultOpen: boolean;
  nowMs: number;
  streamRunning: boolean;
  compact?: boolean;
}) {
  const rejected = group.events.filter((e) => e.event === "verification_rejected").length;
  const visibleEvents = compact ? group.events.slice(-4) : group.events;
  const hiddenEventCount = group.events.length - visibleEvents.length;
  const lastEventTs = group.events.length
    ? Date.parse(group.events[group.events.length - 1]?.ts ?? "")
    : 0;
  const isStale =
    streamRunning && !group.done && lastEventTs > 0 && nowMs - lastEventTs > 5 * 60 * 1000;
  return (
    <SlideIn>
      <Collapsible defaultOpen={defaultOpen}>
        <div className="panel overflow-hidden rounded-xl">
          <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/85 to-primary/70 text-white shadow-[0_4px_14px_-4px_rgba(255,92,57,0.45)]">
              <Building2 className="size-3.5" strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">
                {group.business}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {group.events.length} event{group.events.length === 1 ? "" : "s"}
                {rejected > 0 ? ` · ${rejected} rejected` : ""}
              </span>
            </span>
            {group.done ? (
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
                  verificationTone(group.done.verification_level),
                )}
              >
                {group.done.verification_level ?? "done"}
                {typeof group.done.score === "number" ? ` · ${group.done.score}` : ""}
              </span>
            ) : !streamRunning ? (
              <span className="shrink-0 rounded-full border border-destructive/35 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                stopped
              </span>
            ) : (
              <LiveDot tone="primary" className="shrink-0" />
            )}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-data-[state=open]/trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-0.5 border-t border-border/40 px-1.5 py-1.5">
              {visibleEvents.map((evt, i) => (
                <EventRow
                  key={`${evt.ts}-${evt.event}-${i}`}
                  event={evt}
                  active={!group.done && i === visibleEvents.length - 1}
                />
              ))}
              {compact && hiddenEventCount > 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                  {hiddenEventCount} earlier event{hiddenEventCount === 1 ? "" : "s"} hidden.
                </p>
              ) : null}
              {!group.done ? (
                <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/12 text-primary">
                    <TypingDots />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {!streamRunning
                      ? "stopped before completion"
                      : isStale
                      ? "possibly hung — waiting for next event…"
                      : "working — next step streaming in…"}
                  </span>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </SlideIn>
  );
});

const LOG_CAP = 200;

function JobTimelineStream({
  jobId,
  onDone,
  compact = false,
}: {
  jobId: string;
  onDone?: (status: string) => void;
  compact?: boolean;
}) {
  const { status, phase, lines, events } = useJobStream({ jobId, onDone });
  const [showRaw, setShowRaw] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [lines, events, paused, showRaw]);

  useEffect(() => {
    if (status !== "running" && status !== "pending") return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [status]);

  const totals = useMemo(() => {
    let credits = 0;
    for (const evt of events) {
      if (evt.event === "lead_done" && typeof evt.credits === "number") {
        credits += evt.credits;
      }
    }
    const leadsDone = events.filter((e) => e.event === "lead_done").length;
    const leadsStarted = new Set(
      events.filter((e) => e.place_id).map((e) => e.place_id),
    ).size;
    const rejected = events.filter((e) => e.event === "verification_rejected").length;
    return { credits, leadsDone, leadsStarted, rejected };
  }, [events]);

  const { runEvents, leads } = useMemo(() => groupByLead(events), [events]);
  const visibleRunEvents = useMemo(
    () => (compact ? runEvents.slice(-4) : runEvents),
    [compact, runEvents],
  );
  const visibleLeads = useMemo(
    () => (compact ? leads.slice(-3) : leads),
    [compact, leads],
  );
  const hiddenActivityCount =
    runEvents.length - visibleRunEvents.length + leads.length - visibleLeads.length;
  const visibleLines = useMemo(
    () => (showFullLog ? lines : lines.slice(-LOG_CAP)),
    [lines, showFullLog],
  );
  const running = status === "running" || status === "pending";
  const streamIssue = phase === "reconnecting" || phase === "polling";
  const staleMs = 5 * 60 * 1000;
  const lastEventTs = events.length
    ? Date.parse(events[events.length - 1]?.ts ?? "")
    : 0;
  const isStale =
    running &&
    lastEventTs > 0 &&
    now - lastEventTs > staleMs &&
    !events.some((e) => e.event === "run_done");

  return (
    <div className={cn("rounded-2xl", running && "live-ring p-px")}>
      <div className="panel-strong panel-sheen overflow-hidden rounded-2xl">
        <div className="relative border-b border-border/50 px-5 pb-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl text-white shadow-lg",
                  running
                    ? "bg-gradient-to-br from-primary to-primary/80"
                    : status === "completed"
                      ? "bg-gradient-to-br from-success to-success/80"
                      : "bg-gradient-to-br from-destructive to-destructive/80",
                )}
              >
                <SquareTerminal className="size-4.5" strokeWidth={2.25} />
              </span>
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Live run
                  {running ? <LiveDot tone="primary" /> : null}
                </p>
                <p className="text-xs capitalize text-muted-foreground">
                  {running
                    ? streamIssue
                      ? "reconnecting - holding last telemetry"
                      : isStale
                      ? "possibly hung — no events for 5+ minutes"
                      : "streaming events…"
                    : status}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <CancelJobButton jobId={jobId} visible={running} />
              {!compact ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={showRaw ? "secondary" : "ghost"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    <SquareTerminal className="size-3.5" />
                    Raw
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setPaused((v) => !v)}
                  >
                    {paused ? "Follow" : "Pause"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="panel rounded-xl px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Leads
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums leading-none">
                <AnimatedNumber value={totals.leadsDone} />
                <span className="text-xs font-medium text-muted-foreground">
                  {" "}
                  / {Math.max(totals.leadsStarted, totals.leadsDone)}
                </span>
              </p>
            </div>
            <div className="panel rounded-xl px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Coins className="size-3" />
                Credits
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-warning">
                <Odometer value={totals.credits} climbSeconds={1.4} />
              </p>
            </div>
            <div className="panel rounded-xl px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <ShieldX className="size-3" />
                Rejected
              </p>
              <p
                className={cn(
                  "mt-0.5 text-lg font-bold tabular-nums leading-none",
                  totals.rejected > 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                <AnimatedNumber value={totals.rejected} />
              </p>
            </div>
          </div>
        </div>

        <div className="p-3">
          {showRaw && !compact ? (
            <div className="space-y-2">
              {!showFullLog && lines.length > LOG_CAP ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowFullLog(true)}
                >
                  View full log ({lines.length} lines)
                </Button>
              ) : null}
              <pre className="max-h-96 overflow-auto rounded-xl border border-white/5 bg-[#0b0b0b] p-3.5 font-mono text-[11px] leading-relaxed text-[#ece9e1] shadow-inner">
                {visibleLines.join("\n") || "Waiting for output…"}
                <div ref={bottomRef} />
              </pre>
            </div>
          ) : (
            <div
              className={cn(
                "space-y-2 overflow-auto pr-1",
                compact ? "max-h-[22rem]" : "max-h-96",
              )}
            >
              {events.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-5">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
                    {running ? <TypingDots /> : null}
                    <span className="font-mono text-[11px] leading-relaxed">
                      {nowLine({
                        events,
                        lines,
                        fallback: running
                          ? "Spawning pallares-leads… waiting for the first CLI line"
                          : "No structured events for this job",
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Structured lead cards appear after the run emits JSON progress events.
                    Raw CLI output is available via Raw.
                  </p>
                </div>
              ) : (
                <>
                  {visibleRunEvents.length > 0 ? (
                    <SlideIn>
                      <div className="panel space-y-0.5 rounded-xl px-1.5 py-1.5">
                        {visibleRunEvents.map((evt, i) => (
                          <EventRow key={`run-${evt.ts}-${i}`} event={evt} />
                        ))}
                      </div>
                    </SlideIn>
                  ) : null}
                  {visibleLeads.map((group, i) => (
                    <LeadGroupCard
                      key={group.key}
                      group={group}
                      defaultOpen={i === visibleLeads.length - 1}
                      nowMs={now}
                      streamRunning={running}
                      compact={compact}
                    />
                  ))}
                  {compact && hiddenActivityCount > 0 ? (
                    <p className="px-2 pb-1 text-center text-[11px] text-muted-foreground">
                      Showing latest activity - {hiddenActivityCount} earlier item
                      {hiddenActivityCount === 1 ? "" : "s"} tucked away.
                    </p>
                  ) : null}
                </>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function JobTimeline({
  jobId,
  onDone,
  compact,
}: {
  jobId: string;
  onDone?: (status: string) => void;
  compact?: boolean;
}) {
  return <JobTimelineStream key={jobId} jobId={jobId} onDone={onDone} compact={compact} />;
}
