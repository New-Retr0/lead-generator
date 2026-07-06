"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useRunStream } from "@/lib/use-run-stream";
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

function EventRow({ event, active }: { event: JobEvent; active?: boolean }) {
  const meta = metaFor(event);
  const tone = TONE_STYLES[meta.tone];
  const Icon = meta.icon;
  const chipClass = cn(
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border",
    tone.chip,
  );
  return (
    <SlideIn>
      <div className="group/row flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent/40">
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
}

function LeadGroupCard({
  group,
  defaultOpen,
  nowMs,
}: {
  group: LeadGroup;
  defaultOpen: boolean;
  nowMs: number;
}) {
  const rejected = group.events.filter((e) => e.event === "verification_rejected").length;
  const lastEventTs = group.events.length
    ? Date.parse(group.events[group.events.length - 1]?.ts ?? "")
    : 0;
  const isStale =
    !group.done && lastEventTs > 0 && nowMs - lastEventTs > 5 * 60 * 1000;
  return (
    <SlideIn>
      <Collapsible defaultOpen={defaultOpen}>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/85 to-[oklch(0.55_0.16_290)] text-white shadow-[0_4px_14px_-4px_oklch(0.5_0.19_262/0.6)]">
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
            ) : (
              <LiveDot tone="primary" className="shrink-0" />
            )}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-data-[state=open]/trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-0.5 border-t border-border/40 px-1.5 py-1.5">
              {group.events.map((evt, i) => (
                <EventRow
                  key={`${evt.ts}-${i}`}
                  event={evt}
                  active={!group.done && i === group.events.length - 1}
                />
              ))}
              {!group.done ? (
                <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/12 text-primary">
                    <TypingDots />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isStale
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
}

function JobTimelineRealtime({
  runId,
  onDone,
}: {
  runId: string;
  onDone?: (status: string) => void;
}) {
  const stream = useRunStream(runId, true);
  const [showRaw, setShowRaw] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasLiveRef = useRef(true);

  const events = stream.events;
  const running = !events.some((e) => e.event === "run_done");

  useEffect(() => {
    if (running) return;
    if (wasLiveRef.current) onDone?.("completed");
  }, [running, onDone]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [events, paused, showRaw]);

  useEffect(() => {
    if (running) {
      const id = window.setInterval(() => setNow(Date.now()), 30_000);
      return () => window.clearInterval(id);
    }
  }, [running]);

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
    <TimelineShell
      running={running}
      status={running ? "running" : "completed"}
      isStale={isStale}
      streamConnected={stream.connected}
      showRaw={showRaw}
      paused={paused}
      totals={totals}
      streamUsd={stream.totalUsd}
      usdPerMinute={stream.usdPerMinute}
      runEvents={runEvents}
      leads={leads}
      nowMs={now}
      rawLines={[]}
      loading={stream.loading && events.length === 0}
      hasEvents={runEvents.length > 0 || leads.length > 0}
      onToggleRaw={() => setShowRaw((v) => !v)}
      onTogglePause={() => setPaused((v) => !v)}
      bottomRef={bottomRef}
    />
  );
}

function TimelineShell({
  running,
  status,
  isStale,
  streamConnected,
  showRaw,
  paused,
  totals,
  streamUsd,
  usdPerMinute,
  runEvents,
  leads,
  nowMs,
  rawLines,
  loading,
  hasEvents = false,
  onToggleRaw,
  onTogglePause,
  bottomRef,
}: {
  running: boolean;
  status: string;
  isStale: boolean;
  streamConnected?: boolean;
  showRaw: boolean;
  paused: boolean;
  totals: { credits: number; leadsDone: number; leadsStarted: number; rejected: number };
  streamUsd?: number;
  usdPerMinute?: number;
  runEvents: JobEvent[];
  leads: LeadGroup[];
  nowMs: number;
  rawLines: string[];
  loading?: boolean;
  hasEvents?: boolean;
  onToggleRaw: () => void;
  onTogglePause: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={cn("rounded-2xl", running && "live-ring p-px")}>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="relative border-b border-border/50 px-5 pb-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl text-white shadow-lg",
                  running
                    ? "bg-gradient-to-br from-primary to-[oklch(0.6_0.16_300)]"
                    : status === "completed"
                      ? "bg-gradient-to-br from-success to-[oklch(0.62_0.13_183)]"
                      : "bg-gradient-to-br from-destructive to-[oklch(0.55_0.2_15)]",
                )}
              >
                <SquareTerminal className="size-4.5" strokeWidth={2.25} />
              </span>
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Live run
                  {running ? <LiveDot tone="primary" /> : null}
                  {streamConnected === false && running ? (
                    <span className="text-[10px] font-normal text-warning">reconnecting…</span>
                  ) : null}
                </p>
                <p className="text-xs capitalize text-muted-foreground">
                  {running
                    ? isStale
                      ? "possibly hung — no events for 5+ minutes"
                      : "streaming via Supabase Realtime…"
                    : status}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={showRaw ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={onToggleRaw}
              >
                <SquareTerminal className="size-3.5" />
                Raw
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                onClick={onTogglePause}
              >
                {paused ? "Follow" : "Pause"}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
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
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Coins className="size-3" />
                Credits
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-warning">
                <Odometer value={totals.credits} climbSeconds={1.4} />
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
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
            {typeof streamUsd === "number" ? (
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Spend
                </p>
                <p className="mt-0.5 text-lg font-bold tabular-nums leading-none">
                  ${streamUsd.toFixed(2)}
                </p>
                {typeof usdPerMinute === "number" && usdPerMinute > 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    ${usdPerMinute.toFixed(2)}/min
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-3">
          {showRaw ? (
            <pre className="max-h-96 overflow-auto rounded-xl border border-white/5 bg-[oklch(0.15_0.02_262)] p-3.5 font-mono text-[11px] leading-relaxed text-[oklch(0.84_0.01_250)] shadow-inner">
              {rawLines.join("\n") || "Waiting for output…"}
              <div ref={bottomRef} />
            </pre>
          ) : (
            <div className="max-h-96 space-y-2 overflow-auto pr-1">
              {loading ? (
                <div className="space-y-2 py-2">
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    Loading live events…
                  </p>
                </div>
              ) : !hasEvents ? (
                <div className="space-y-2 py-2">
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    Waiting for structured events…
                  </p>
                </div>
              ) : (
                <>
                  {runEvents.length > 0 ? (
                    <SlideIn>
                      <div className="space-y-0.5 rounded-lg border border-border bg-card px-1.5 py-1.5">
                        {runEvents.map((evt, i) => (
                          <EventRow key={`run-${evt.ts}-${i}`} event={evt} />
                        ))}
                      </div>
                    </SlideIn>
                  ) : null}
                  {leads.map((group, i) => (
                    <LeadGroupCard
                      key={group.key}
                      group={group}
                      defaultOpen={i === leads.length - 1}
                      nowMs={nowMs}
                    />
                  ))}
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

function JobTimelineStream({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (status: string) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState("running");
  const [showRaw, setShowRaw] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasLiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    wasLiveRef.current = false;
    // Reset stream UI when switching jobs (not an external-store subscription).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jobId change reset
    setLines([]);
    setEvents([]);
    setStatus("running");

    void fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((body: { job?: { status: string } }) => {
        if (cancelled) return;
        const initial = body.job?.status ?? "running";
        setStatus(initial);
        wasLiveRef.current = initial === "running";
      })
      .catch(() => {
        if (!cancelled) wasLiveRef.current = true;
      });

    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.addEventListener("log", (event) => {
      const data = JSON.parse(event.data) as { line: string };
      setLines((prev) => [...prev, data.line]);
    });

    source.addEventListener("event", (event) => {
      const data = JSON.parse(event.data) as JobEvent;
      setEvents((prev) => [...prev, data]);
    });

    source.addEventListener("done", (event) => {
      const data = JSON.parse(event.data) as { status: string };
      setStatus(data.status);
      if (wasLiveRef.current) onDone?.(data.status);
      source.close();
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setStatus("error");
      source.close();
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [jobId, onDone]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [lines, events, paused, showRaw]);

  useEffect(() => {
    if (status !== "running") return;
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
  const running = status === "running";
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
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {/* header */}
        <div className="relative border-b border-border/50 px-5 pb-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl text-white shadow-lg",
                  running
                    ? "bg-gradient-to-br from-primary to-[oklch(0.6_0.16_300)]"
                    : status === "completed"
                      ? "bg-gradient-to-br from-success to-[oklch(0.62_0.13_183)]"
                      : "bg-gradient-to-br from-destructive to-[oklch(0.55_0.2_15)]",
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
                    ? isStale
                      ? "possibly hung — no events for 5+ minutes"
                      : "streaming events…"
                    : status}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
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
            </div>
          </div>

          {/* live counters */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
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
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Coins className="size-3" />
                Credits
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-warning">
                <Odometer value={totals.credits} climbSeconds={1.4} />
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
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

        {/* body */}
        <div className="p-3">
          {showRaw ? (
            <pre className="max-h-96 overflow-auto rounded-xl border border-white/5 bg-[oklch(0.15_0.02_262)] p-3.5 font-mono text-[11px] leading-relaxed text-[oklch(0.84_0.01_250)] shadow-inner">
              {lines.join("\n") || "Waiting for output…"}
              <div ref={bottomRef} />
            </pre>
          ) : (
            <div className="max-h-96 space-y-2 overflow-auto pr-1">
              {events.length === 0 ? (
                <div className="space-y-2 py-2">
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <div className="shimmer h-12 rounded-xl border border-border/40" />
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    Waiting for structured events…
                  </p>
                </div>
              ) : (
                <>
                  {runEvents.length > 0 ? (
                    <SlideIn>
                      <div className="space-y-0.5 rounded-lg border border-border bg-card px-1.5 py-1.5">
                        {runEvents.map((evt, i) => (
                          <EventRow key={`run-${evt.ts}-${i}`} event={evt} />
                        ))}
                      </div>
                    </SlideIn>
                  ) : null}
                  {leads.map((group, i) => (
                    <LeadGroupCard
                      key={group.key}
                      group={group}
                      defaultOpen={i === leads.length - 1}
                      nowMs={now}
                    />
                  ))}
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
  runId,
  onDone,
}: {
  jobId?: string;
  runId?: string;
  onDone?: (status: string) => void;
}) {
  if (runId) {
    return <JobTimelineRealtime key={runId} runId={runId} onDone={onDone} />;
  }
  if (jobId) {
    return <JobTimelineStream key={jobId} jobId={jobId} onDone={onDone} />;
  }
  return null;
}
