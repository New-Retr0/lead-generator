"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Flame,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Workflow,
} from "lucide-react";
import { LiveDot } from "@/components/animated";
import { EASE } from "@/components/console/motion";
import { PipelineActivity } from "@/components/pipeline/pipeline-activity";
import { jobEventsToRunTimeline } from "@/lib/pipeline/events-to-timeline";
import { PipelineRail } from "@/components/pipeline/pipeline-rail";
import { PipelineSignal } from "@/components/pipeline/pipeline-signal";
import { PipelineSpendReel } from "@/components/pipeline/pipeline-spend-reel";
import {
  SpringCount,
  SpringSeconds,
  SpringUsd,
} from "@/components/pipeline/spring-usd";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CostGroup, StageStat } from "@/lib/pipeline/rollup";
import {
  PIPELINE_STAGES,
  eventToStage,
  providerColor,
  type PipelineCostEvent,
  type PipelineProvider,
  type PipelineTimelineEntry,
} from "@/lib/pipeline/stages";
import {
  REPLAY_SPEEDS,
  buildStageSegments,
  firstHitMs,
  formatClock,
  resolvePlaybackFrame,
  sliceCosts,
  stageIndex,
  timelineBounds,
  type ReplaySpeed,
} from "@/lib/pipeline/studio";
import type { JobEvent, RunTimeline } from "@/lib/types";

/** Scrubber tick — springs handle the visual fluidity between updates. */
const SCRUB_TICK_MS = 48;
/** Live ring fill cadence while a stage is the current focus. */
const LIVE_RING_MS = 6_000;

const NUMBER_SPRING = { stiffness: 48, damping: 18 };

function StageIcon({
  provider,
  className,
}: {
  provider: PipelineProvider | string;
  className?: string;
}) {
  if (provider === "firecrawl") return <Flame className={className} />;
  if (provider === "google_places") return <MapPin className={className} />;
  return <Workflow className={className} />;
}

/**
 * Operator replay of a single research run: watch stages fire, spend climb,
 * and leads advance — so you can see *what happened* without reading raw logs.
 */
export function PipelinePlayer({
  timeline,
  costs,
  events = [],
  activeStages,
  isLive,
  playing,
  onPlayingChange,
  virtualMs,
  onVirtualMsChange,
  speed,
  onSpeedChange,
  runStartedAt,
  runEndedAt,
  runTimeline = null,
  liveNames,
}: {
  timeline: PipelineTimelineEntry[];
  costs: PipelineCostEvent[];
  events?: JobEvent[];
  stageStats?: Map<string, StageStat>;
  stageRollup?: Map<string, CostGroup>;
  activeStages: Set<string>;
  isLive: boolean;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;
  virtualMs: number | null;
  onVirtualMsChange: (ms: number | null) => void;
  speed: ReplaySpeed;
  onSpeedChange: (v: ReplaySpeed) => void;
  runStartedAt: string | null;
  runEndedAt: string | null;
  runTimeline?: RunTimeline | null;
  liveNames?: Record<string, string>;
}) {
  const reduced = useReducedMotion();
  const rafRef = useRef<number | null>(null);
  const lastTick = useRef<number | null>(null);
  const lastScrubPush = useRef(0);
  const virtualMsRef = useRef(virtualMs);
  const speedRef = useRef(speed);
  const onVirtualMsChangeRef = useRef(onVirtualMsChange);
  const onPlayingChangeRef = useRef(onPlayingChange);

  const [playScrubMs, setPlayScrubMs] = useState<number | null>(null);
  const [liveRingProgress, setLiveRingProgress] = useState(0);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    onVirtualMsChangeRef.current = onVirtualMsChange;
  }, [onVirtualMsChange]);
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);
  useEffect(() => {
    if (!playing) virtualMsRef.current = virtualMs;
  }, [virtualMs, playing]);

  const bounds = useMemo(
    () => timelineBounds(timeline, runStartedAt, runEndedAt),
    [timeline, runStartedAt, runEndedAt],
  );

  const segments = useMemo(
    () => buildStageSegments(timeline, bounds),
    [timeline, bounds],
  );

  const scrubMs = playing && playScrubMs != null ? playScrubMs : virtualMs;
  const playheadMs = isLive ? bounds.end : (scrubMs ?? bounds.end);

  const frame = useMemo(
    () => resolvePlaybackFrame(playheadMs, segments, costs, timeline),
    [playheadMs, segments, costs, timeline],
  );

  const focusId = frame.stageId;
  const focusDef = PIPELINE_STAGES.find((s) => s.id === focusId) ?? PIPELINE_STAGES[0];
  const focusIndex = stageIndex(focusId);
  const focusAccent = providerColor(focusDef?.provider ?? "system");
  const focusBusiness = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const entry = timeline[i];
      if (!entry || entry.kind === "cost") continue;
      if (eventToStage(entry.event) !== focusId) continue;
      if (typeof entry.event.business === "string" && entry.event.business) {
        return entry.event.business;
      }
    }
    return null;
  }, [timeline, focusId]);

  useEffect(() => {
    if (!isLive || reduced) return;
    const enteredAt = Date.now();
    const tick = () => {
      setLiveRingProgress(
        Math.min(0.96, Math.max(0, (Date.now() - enteredAt) / LIVE_RING_MS)),
      );
    };
    const kick = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 90);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(id);
    };
  }, [isLive, reduced, focusId]);

  const displayProgress = isLive
    ? reduced
      ? 1
      : liveRingProgress
    : frame.segmentProgress;

  const visibleCosts = useMemo(
    () => sliceCosts(costs, isLive ? null : playheadMs),
    [costs, isLive, playheadMs],
  );

  const reachedStages = useMemo(() => {
    const set = new Set<string>();
    for (const seg of segments) {
      if (seg.startMs <= playheadMs) set.add(seg.stageId);
    }
    for (const id of activeStages) set.add(id);
    return set;
  }, [segments, playheadMs, activeStages]);

  // Lead Activity must track the same live event stream as the DAG — not a
  // separately polled detail.timeline that can freeze mid-run.
  const activityTimeline = useMemo(() => {
    if (events.length > 0) {
      return jobEventsToRunTimeline(events, liveNames);
    }
    return runTimeline;
  }, [events, liveNames, runTimeline]);

  useEffect(() => {
    if (!playing || isLive) {
      lastTick.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = (now: number) => {
      if (lastTick.current == null) lastTick.current = now;
      const delta = now - lastTick.current;
      lastTick.current = now;
      const base = virtualMsRef.current ?? bounds.start;
      const next = Math.min(bounds.end, base + delta * speedRef.current);
      virtualMsRef.current = next;

      if (now - lastScrubPush.current >= SCRUB_TICK_MS || next >= bounds.end) {
        lastScrubPush.current = now;
        setPlayScrubMs(next);
        onVirtualMsChangeRef.current(next);
      }

      if (next >= bounds.end) {
        onVirtualMsChangeRef.current(bounds.end);
        setPlayScrubMs(null);
        onPlayingChangeRef.current(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, isLive, bounds.end, bounds.start]);

  const jumpToStage = (stageId: string) => {
    if (isLive) return;
    const ms = firstHitMs(timeline, stageId, bounds.start, bounds.end);
    virtualMsRef.current = ms;
    setPlayScrubMs(null);
    onVirtualMsChange(ms);
    onPlayingChange(false);
  };

  const togglePlay = () => {
    if (playing) {
      onVirtualMsChange(virtualMsRef.current);
      setPlayScrubMs(null);
      onPlayingChange(false);
      return;
    }
    let startAt = playheadMs;
    if (startAt >= bounds.end - 50) {
      startAt = bounds.start;
      onVirtualMsChange(bounds.start);
    }
    virtualMsRef.current = startAt;
    setPlayScrubMs(startAt);
    onPlayingChange(true);
  };

  return (
    <div className="min-w-0 w-full max-w-full rounded-2xl border border-border/60 bg-card">
      {/* Transport */}
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 border-b border-border/40 px-3 py-3 sm:gap-3 sm:px-5">
        {isLive ? (
          <div className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1">
            <LiveDot tone="primary" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
              Live
            </span>
          </div>
        ) : (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              onClick={() => {
                virtualMsRef.current = bounds.start;
                setPlayScrubMs(null);
                onVirtualMsChange(bounds.start);
                onPlayingChange(false);
              }}
              aria-label="Reset"
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </Button>
          </>
        )}

        <div className="min-w-0 flex-1 basis-[12rem]">
          {!isLive ? (
            <>
              <Slider
                min={bounds.start}
                max={bounds.end}
                step={Math.max(1, Math.floor((bounds.end - bounds.start) / 600))}
                value={[playheadMs]}
                onValueChange={(value) => {
                  const next = value[0] ?? bounds.start;
                  onPlayingChange(false);
                  virtualMsRef.current = next;
                  setPlayScrubMs(null);
                  onVirtualMsChange(next);
                }}
                aria-label="Replay position"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                <span>{formatClock(playheadMs - bounds.start)}</span>
                <span>{formatClock(bounds.end - bounds.start)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Following the latest stage</p>
          )}
        </div>

        {!isLive ? (
          <ToggleGroup
            type="single"
            value={String(speed)}
            onValueChange={(v) => {
              if (!v) return;
              const n = Number(v);
              if (REPLAY_SPEEDS.includes(n as ReplaySpeed)) {
                onSpeedChange(n as ReplaySpeed);
              }
            }}
            className="shrink-0"
          >
            {REPLAY_SPEEDS.map((s) => (
              <ToggleGroupItem key={s} value={String(s)} className="h-8 px-2.5 text-[10px]">
                {s}×
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      {/* Now on stage */}
      <div className="min-w-0 space-y-4 px-3 py-4 sm:px-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/40"
              style={{ color: focusAccent }}
            >
              <StageIcon provider={focusDef?.provider ?? "system"} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Stage {focusIndex + 1}/{PIPELINE_STAGES.length}
                {" · "}
                {(focusDef?.provider ?? "system").replace(/_/g, " ")}
                {focusDef?.conditional ? " · optional" : ""}
              </p>
              <div className="relative min-h-8">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.h4
                    key={focusId}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="break-words text-xl font-semibold tracking-tight sm:text-2xl"
                  >
                    {focusDef?.label ?? focusId}
                  </motion.h4>
                </AnimatePresence>
              </div>
              {focusBusiness ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Latest · {focusBusiness}
                </p>
              ) : null}
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-sm text-muted-foreground">
                  <SpringCount value={frame.hitCount} /> hits
                  {" · "}
                  <SpringSeconds valueMs={frame.dwellMs} />
                </p>
                <PipelineSignal
                  stageId={focusId}
                  provider={focusDef?.provider ?? "system"}
                  active={isLive || playing}
                />
              </div>
            </div>
          </div>

          <div className="shrink-0 sm:text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Run spend
            </p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              <SpringUsd
                value={frame.runUsd}
                digits={2}
                stiffness={NUMBER_SPRING.stiffness}
                damping={NUMBER_SPRING.damping}
              />
            </p>
            <p className="text-xs text-muted-foreground">
              stage{" "}
              <SpringUsd
                value={frame.stageUsd}
                digits={4}
                stiffness={NUMBER_SPRING.stiffness}
                damping={NUMBER_SPRING.damping}
                className="text-foreground/80"
              />
            </p>
          </div>
        </div>

        <PipelineSpendReel
          costs={visibleCosts}
          focusStageId={focusId}
          onFocusStage={jumpToStage}
        />
      </div>

      {/* Stage rail scrolls inside the card — never widens the page */}
      <div className="min-w-0 border-t border-border/40 px-2 py-4 sm:px-4">
        <PipelineRail
          focusId={focusId}
          segmentProgress={displayProgress}
          reachedStages={reachedStages}
          onSelect={jumpToStage}
        />
      </div>

      <div className="min-w-0 border-t border-border/40 px-3 py-4 sm:px-5">
        <PipelineActivity
          runTimeline={activityTimeline}
          liveNames={liveNames}
          playheadMs={isLive ? null : playheadMs}
          focusStageId={focusId}
          isLive={isLive}
          playing={playing}
          atEnd={
            !isLive &&
            !playing &&
            playheadMs >= bounds.end - 80
          }
        />
      </div>
    </div>
  );
}
