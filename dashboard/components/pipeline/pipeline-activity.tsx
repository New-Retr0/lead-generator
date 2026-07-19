"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { Building2, Check } from "lucide-react";
import { LiveDot } from "@/components/animated";
import { duration, EASE } from "@/components/console/motion";
import { Badge } from "@/components/ui/badge";
import {
  PIPELINE_STAGES,
  canonicalStageId,
  timelineLeadIsDone,
} from "@/lib/pipeline/stages";
import { stageLabel } from "@/lib/pipeline/studio";
import type { RunTimeline, RunTimelineLead, RunTimelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE_ORDER = new Map(PIPELINE_STAGES.map((s, i) => [s.id, i]));

/** Wall-clock hold per lead while the film is running — keeps swaps calm. */
const SPOTLIGHT_DWELL_MS = 4_200;
/** Poll how often we may advance the spotlight. */
const SPOTLIGHT_TICK_MS = 250;

const cardSwap = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: duration.slow, ease: EASE },
} as const;

const listEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: duration.normal, ease: EASE },
} as const;

/** One badge per studio stage — merge repeat scrapes / source_check:* rows. */
function dedupeStages(stages: RunTimelineStage[]): RunTimelineStage[] {
  const byKey = new Map<string, RunTimelineStage>();
  for (const stage of stages) {
    const key = canonicalStageId(stage.stage);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...stage, stage: key });
      continue;
    }
    byKey.set(key, {
      ...prev,
      ran: prev.ran || stage.ran,
      credits_est: (prev.credits_est ?? 0) + (stage.credits_est ?? 0),
      created_at:
        stage.created_at > prev.created_at ? stage.created_at : prev.created_at,
      reason: stage.reason ?? prev.reason,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const ai = STAGE_ORDER.get(a.stage) ?? 999;
    const bi = STAGE_ORDER.get(b.stage) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.created_at.localeCompare(b.created_at);
  });
}

function leadVisibleAt(
  lead: RunTimelineLead,
  playheadMs: number | null,
): RunTimelineLead {
  const timed =
    playheadMs == null
      ? lead.stages
      : lead.stages.filter((s) => new Date(s.created_at).getTime() <= playheadMs);
  const stages = dedupeStages(timed);
  return {
    ...lead,
    stages,
    done: timelineLeadIsDone({ done: lead.done, stages }),
  };
}

function firstActivityMs(lead: RunTimelineLead): number {
  const ts = lead.stages[0]?.created_at;
  return ts ? new Date(ts).getTime() : Number.POSITIVE_INFINITY;
}

function lastActivityMs(lead: RunTimelineLead): number {
  const ts = lead.stages[lead.stages.length - 1]?.created_at;
  return ts ? new Date(ts).getTime() : 0;
}

function leadName(
  lead: RunTimelineLead,
  liveNames?: Record<string, string>,
): string {
  return (
    lead.business_name ??
    liveNames?.[lead.place_id] ??
    `…${lead.place_id.replace(/^places\//, "").slice(-6)}`
  );
}

/** Live stream: follow the place currently cooking — not a replay from lead #1. */
function pickLiveFocus(queue: RunTimelineLead[]): RunTimelineLead | null {
  if (queue.length === 0) return null;
  const inFlight = queue.filter((l) => !l.done);
  const pool = inFlight.length > 0 ? inFlight : queue;
  let best = pool[0];
  for (const lead of pool) {
    if (lastActivityMs(lead) >= lastActivityMs(best)) best = lead;
  }
  return best;
}

function LeadCard({
  lead,
  name,
  focusKey,
  featured,
}: {
  lead: RunTimelineLead;
  name: string;
  focusKey: string;
  featured?: boolean;
}) {
  const finished = timelineLeadIsDone(lead);
  // Prefer this place's latest stage for the hot chip so global studio focus
  // (another parallel place at lead_done) cannot leave this card looking stuck.
  const localFocus =
    lead.stages.length > 0
      ? canonicalStageId(lead.stages[lead.stages.length - 1]!.stage)
      : focusKey;
  const hotKey = finished ? "lead_done" : localFocus;

  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        featured
          ? "border-primary/40 bg-primary/[0.05]"
          : "border-border/50 bg-muted/20",
      )}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background text-muted-foreground">
          <Building2 className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {!finished ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            <LiveDot tone="primary" />
            In progress
          </span>
        ) : lead.verification_level ? (
          <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
            {lead.verification_level}
          </Badge>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Done
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {lead.stages.map((stage) => {
          const key = canonicalStageId(stage.stage);
          const hot = key === hotKey;
          const label = stageLabel(key);
          return (
            <span
              key={key}
              title={label}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-500 ease-out",
                hot
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/50 bg-background/70 text-muted-foreground",
              )}
            >
              {stage.ran ? (
                <Check className="size-2.5 shrink-0 text-primary" />
              ) : (
                <span className="size-2.5 shrink-0 rounded-full border border-border" />
              )}
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * During live / replay: one lead at a time (paced spotlight).
 * When the film settles: full list.
 */
export function PipelineActivity({
  runTimeline,
  liveNames,
  playheadMs,
  focusStageId,
  isLive,
  playing = false,
  atEnd = false,
}: {
  runTimeline: RunTimeline | null;
  liveNames?: Record<string, string>;
  playheadMs: number | null;
  focusStageId: string;
  isLive: boolean;
  playing?: boolean;
  /** Replay finished (or scrubbed to the end) — show the settled list. */
  atEnd?: boolean;
}) {
  const reduced = useSafeReducedMotion();
  const focusKey = canonicalStageId(focusStageId);

  /** One-at-a-time while live / playing; list once the film settles at the end. */
  const filmMode = isLive || playing || !atEnd;
  const autoAdvance = isLive || playing;

  const queue = useMemo(() => {
    if (!runTimeline) return [] as RunTimelineLead[];
    const sliced = runTimeline.leads
      .map((lead) => leadVisibleAt(lead, isLive || playheadMs == null ? null : playheadMs))
      .filter((lead) => lead.stages.length > 0);

    return sliced.sort((a, b) => {
      const fa = firstActivityMs(a);
      const fb = firstActivityMs(b);
      if (fa !== fb) return fa - fb;
      return a.place_id.localeCompare(b.place_id);
    });
  }, [runTimeline, playheadMs, isLive]);

  const allLeads = useMemo(() => {
    if (!runTimeline) return [] as RunTimelineLead[];
    return runTimeline.leads
      .map((lead) => leadVisibleAt(lead, null))
      .filter((lead) => lead.stages.length > 0)
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
  }, [runTimeline]);

  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const heldSince = useRef(0);
  const spotlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    spotlightIdRef.current = spotlightId;
  }, [spotlightId]);

  // Fresh replay: start the spotlight at the first unlocked place.
  useEffect(() => {
    if (!playing) return;
    heldSince.current = Date.now();
    const id = window.setTimeout(() => setSpotlightId(null), 0);
    return () => window.clearTimeout(id);
  }, [playing]);

  // Live attach: snap to the place currently in flight (skip historical rewind).
  useEffect(() => {
    if (!isLive) return;
    const focus = pickLiveFocus(queue);
    heldSince.current = Date.now();
    const id = window.setTimeout(() => setSpotlightId(focus?.place_id ?? null), 0);
    return () => window.clearTimeout(id);
    // Only re-snap when live mode toggles on — queue updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/live edge
  }, [isLive]);

  // Paused scrub: pin to the place active at the playhead (no carousel).
  useEffect(() => {
    if (!filmMode || autoAdvance) return;
    if (queue.length === 0) {
      const id = window.setTimeout(() => setSpotlightId(null), 0);
      return () => window.clearTimeout(id);
    }
    let best = queue[0]!;
    for (const lead of queue) {
      if (lastActivityMs(lead) >= lastActivityMs(best)) best = lead;
    }
    heldSince.current = Date.now();
    const placeId = best.place_id;
    const id = window.setTimeout(() => setSpotlightId(placeId), 0);
    return () => window.clearTimeout(id);
  }, [filmMode, autoAdvance, queue]);

  // Live: stay on the cooking place; swap smoothly when a newer one takes over.
  useEffect(() => {
    if (!filmMode || !isLive) return;

    const advance = () => {
      if (queue.length === 0) {
        if (spotlightIdRef.current != null) setSpotlightId(null);
        return;
      }

      const now = Date.now();
      const liveFocus = pickLiveFocus(queue);
      if (!liveFocus) return;

      const current = spotlightIdRef.current;
      const currentLead = current
        ? queue.find((l) => l.place_id === current) ?? null
        : null;

      if (!currentLead) {
        heldSince.current = now;
        setSpotlightId(liveFocus.place_id);
        return;
      }

      // Same place still cooking — keep the card; badges update in place.
      if (!currentLead.done && currentLead.place_id === liveFocus.place_id) {
        return;
      }

      // Newer in-flight place appeared, or current finished — wait for dwell, then swap.
      if (liveFocus.place_id === currentLead.place_id) return;

      const settleMs = currentLead.done
        ? Math.min(SPOTLIGHT_DWELL_MS, 2_400)
        : SPOTLIGHT_DWELL_MS;
      if (now - heldSince.current < settleMs) return;

      heldSince.current = now;
      setSpotlightId(liveFocus.place_id);
    };

    advance();
    const id = window.setInterval(advance, SPOTLIGHT_TICK_MS);
    return () => window.clearInterval(id);
  }, [filmMode, isLive, queue]);

  // Replay playing: chronological one-at-a-time through unlocked places.
  useEffect(() => {
    if (!filmMode || !playing || isLive) return;

    const advance = () => {
      if (queue.length === 0) {
        if (spotlightIdRef.current != null) setSpotlightId(null);
        return;
      }

      const current = spotlightIdRef.current;
      const now = Date.now();
      const currentIdx = current
        ? queue.findIndex((l) => l.place_id === current)
        : -1;
      const currentLead = currentIdx >= 0 ? queue[currentIdx] : null;

      if (!currentLead) {
        heldSince.current = now;
        setSpotlightId(queue[0]!.place_id);
        return;
      }

      const next = queue[currentIdx + 1];
      if (!next) return;

      const settleMs = currentLead.done
        ? Math.min(SPOTLIGHT_DWELL_MS, 2_400)
        : SPOTLIGHT_DWELL_MS;
      if (now - heldSince.current < settleMs) return;

      heldSince.current = now;
      setSpotlightId(next.place_id);
    };

    advance();
    const id = window.setInterval(advance, SPOTLIGHT_TICK_MS);
    return () => window.clearInterval(id);
  }, [filmMode, playing, isLive, queue]);

  // Scrub backward / live drop can remove the current place from the queue.
  useEffect(() => {
    if (!filmMode || !spotlightId) return;
    if (queue.some((l) => l.place_id === spotlightId)) return;
    heldSince.current = Date.now();
    const fallback = isLive ? pickLiveFocus(queue) : queue[0];
    const placeId = fallback?.place_id ?? null;
    const id = window.setTimeout(() => setSpotlightId(placeId), 0);
    return () => window.clearTimeout(id);
  }, [filmMode, queue, spotlightId, isLive]);

  const spotlightLead = useMemo(
    () => queue.find((l) => l.place_id === spotlightId) ?? queue[0] ?? null,
    [queue, spotlightId],
  );

  const spotlightIndex = spotlightLead
    ? queue.findIndex((l) => l.place_id === spotlightLead.place_id)
    : -1;

  const stats = useMemo(() => {
    if (!runTimeline) return { done: 0, total: 0, stages: 0, credits: 0 };
    const source = filmMode ? queue : allLeads;
    return {
      done: source.filter((l) => l.done).length,
      total: runTimeline.leads.length,
      stages: source.reduce((n, l) => n + l.stages.length, 0),
      credits: source.reduce((n, l) => n + l.creditsEst, 0),
    };
  }, [runTimeline, filmMode, queue, allLeads]);

  if (!runTimeline || (runTimeline.leads.length === 0 && runTimeline.runEvents.length === 0)) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLive
          ? "Lead stages will appear here as places move through the pipeline."
          : "Lead activity will show here as places move through stages."}
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Lead activity
          </p>
          <p className="text-xs text-muted-foreground">
            {isLive
              ? "Live — one place in progress at a time; full list when the run finishes."
              : filmMode
                ? "One place at a time while the pipeline runs — full list when it settles."
                : "Every place that moved through this run."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span title="Leads finished vs seen in this run">
            <span className="text-foreground">{stats.done}</span>/{stats.total} done
          </span>
          {filmMode && spotlightIndex >= 0 ? (
            <span
              className="text-muted-foreground/80"
              title="Spotlight carousel position (not overall progress)"
            >
              Focus {spotlightIndex + 1}/{queue.length}
            </span>
          ) : null}
          <span>
            <span className="text-foreground">{stats.stages}</span> stages
          </span>
        </div>
      </div>

      {filmMode ? (
        <div className="relative min-h-[7.5rem]">
          <AnimatePresence mode="wait" initial={false}>
            {spotlightLead ? (
              <motion.div
                key={spotlightLead.place_id}
                {...(reduced
                  ? { initial: false, animate: { opacity: 1 } }
                  : cardSwap)}
              >
                <LeadCard
                  lead={spotlightLead}
                  name={leadName(spotlightLead, liveNames)}
                  focusKey={focusKey}
                  featured
                />
              </motion.div>
            ) : (
              <motion.p
                key="waiting"
                {...(reduced ? {} : listEnter)}
                className="py-6 text-center text-xs text-muted-foreground"
              >
                {isLive
                  ? "Waiting for the first lead…"
                  : "Play to step through each place…"}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="max-h-56 space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain">
          <AnimatePresence initial={false}>
            {allLeads.length === 0 ? (
              <motion.p
                key="empty"
                {...(reduced ? {} : listEnter)}
                className="py-4 text-center text-xs text-muted-foreground"
              >
                No lead stages recorded for this run.
              </motion.p>
            ) : (
              allLeads.map((lead, i) => (
                <motion.div
                  key={lead.place_id}
                  layout={false}
                  {...(reduced
                    ? {}
                    : {
                        initial: listEnter.initial,
                        animate: listEnter.animate,
                        transition: {
                          ...listEnter.transition,
                          delay: Math.min(i * 0.04, 0.24),
                        },
                      })}
                >
                  <LeadCard
                    lead={lead}
                    name={leadName(lead, liveNames)}
                    focusKey={focusKey}
                  />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
