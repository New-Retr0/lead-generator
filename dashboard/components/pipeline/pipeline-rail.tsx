"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import {
  Flame,
  MapPin,
  Workflow,
} from "lucide-react";
import {
  PIPELINE_STAGES,
  providerColor,
  type PipelineProvider,
} from "@/lib/pipeline/stages";
import { stageIndex } from "@/lib/pipeline/studio";
import { cn } from "@/lib/utils";

const NODE = 36; // px
const RING = 44; // px — progress stroke sits just outside the node
const SLOT = 76; // px per stage column — room for "optional" caption
/** Room above circles for focus ring / scale (overflow-x clips the y-axis too). */
const TOP_PAD = 12;
const RING_STROKE = 2.5;

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

function nodeColor(provider: PipelineProvider | string, active: boolean): string | undefined {
  if (!active) return undefined;
  if (provider === "system") return "var(--foreground)";
  return providerColor(provider);
}

/** Circumference fill for the active stage — 0→1 as dwell progresses. */
function StageProgressRing({
  progress,
  color,
  reduced,
}: {
  progress: number;
  color: string;
  reduced: boolean | null;
}) {
  const r = (RING - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));

  return (
    <svg
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
      width={RING}
      height={RING}
      viewBox={`0 0 ${RING} ${RING}`}
      aria-hidden
    >
      <circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="text-primary/12"
      />
      <motion.circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - p) }}
        transition={
          reduced
            ? { duration: 0 }
            : { type: "spring", stiffness: 120, damping: 28, mass: 0.8 }
        }
      />
    </svg>
  );
}

/**
 * Stage filmstrip for Pipeline Studio.
 * Conditional stages are always marked optional; skipped ones say so explicitly.
 */
export function PipelineRail({
  focusId,
  segmentProgress,
  reachedStages,
  onSelect,
}: {
  focusId: string;
  /** 0–1 through the current stage dwell */
  segmentProgress: number;
  reachedStages: Set<string>;
  onSelect: (stageId: string) => void;
}) {
  const reduced = useSafeReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const focusIndex = stageIndex(focusId);
  const last = Math.max(PIPELINE_STAGES.length - 1, 1);

  // Tip parks on the active circle; dwell time fills the ring instead of sliding through.
  const tipPct = (Math.min(last, focusIndex) / last) * 100;
  const inset = SLOT / 2;
  const ringProgress = Math.min(1, Math.max(0, segmentProgress));

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const node = scroller.querySelector<HTMLElement>(`[data-stage="${focusId}"]`);
    if (!node) return;
    const pad = 20;
    const left = node.offsetLeft;
    const right = left + node.offsetWidth;
    const viewLeft = scroller.scrollLeft;
    const viewRight = viewLeft + scroller.clientWidth;
    // Only nudge the filmstrip — never when the node is already in view.
    if (left >= viewLeft + pad && right <= viewRight - pad) return;
    const target = Math.max(0, left - scroller.clientWidth / 2 + node.offsetWidth / 2);
    scroller.scrollTo({ left: target, behavior: reduced ? "auto" : "smooth" });
  }, [focusId, reduced]);

  return (
    <div className="min-w-0 w-full max-w-full space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-0.5 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-primary/50 bg-card" />
          Always runs
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-dashed border-foreground/35 bg-card" />
          Optional — only if needed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/80">
            skipped
          </span>
          Didn’t fire this run
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="min-w-0 w-full max-w-full overflow-x-auto overscroll-x-contain"
      >
        <div
          className="relative"
          style={{
            width: PIPELINE_STAGES.length * SLOT,
            paddingTop: TOP_PAD,
            paddingBottom: 4,
          }}
        >
          <div
            className="pointer-events-none absolute h-0.5 -translate-y-1/2 rounded-full bg-border/70"
            style={{
              top: TOP_PAD + NODE / 2,
              left: inset,
              right: inset,
            }}
          >
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              initial={false}
              animate={{ width: `${tipPct}%` }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 90, damping: 22, mass: 0.9 }
              }
            />
          </div>

          <div className="relative flex">
            {PIPELINE_STAGES.map((stage, index) => {
              const reached = reachedStages.has(stage.id);
              const isFocus = stage.id === focusId;
              const past = index < focusIndex;
              const lit = isFocus || reached || past;
              const isOptional = Boolean(stage.conditional);
              const skipped = isOptional && !reached && !isFocus;
              const accent = nodeColor(stage.provider, lit && !skipped);

              const title = isOptional
                ? skipped
                  ? `${stage.label} — optional, skipped on this run`
                  : reached || isFocus
                    ? `${stage.label} — optional, ran this run`
                    : `${stage.label} — optional stage (only if needed)`
                : stage.label;

              return (
                <button
                  key={stage.id}
                  type="button"
                  data-stage={stage.id}
                  onClick={() => onSelect(stage.id)}
                  className="relative z-[1] flex shrink-0 flex-col items-center gap-1"
                  style={{ width: SLOT }}
                  title={title}
                >
                  <motion.span
                    className={cn(
                      "relative flex items-center justify-center rounded-full border bg-card",
                      isFocus && "border-primary/35",
                      !isFocus && lit && !skipped && !isOptional && "border-primary/40",
                      !isFocus && lit && !skipped && isOptional && "border-primary/50 border-dashed",
                      isOptional && !isFocus && !lit && "border-dashed border-foreground/30",
                      skipped && "border-dashed border-border/80",
                      !isFocus && !lit && !isOptional && "border-border",
                    )}
                    style={{
                      width: NODE,
                      height: NODE,
                      color: accent,
                    }}
                    animate={{ scale: isFocus ? 1.06 : 1 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 220, damping: 24 }
                    }
                  >
                    {isFocus ? (
                      <StageProgressRing
                        progress={ringProgress}
                        color={providerColor(stage.provider)}
                        reduced={reduced}
                      />
                    ) : past && lit && !skipped ? (
                      <StageProgressRing
                        progress={1}
                        color={providerColor(stage.provider)}
                        reduced={true}
                      />
                    ) : null}
                    {isOptional ? (
                      <span
                        aria-hidden
                        className="absolute -right-0.5 -top-0.5 z-[1] flex size-3 items-center justify-center rounded-full border border-border/60 bg-background font-mono text-[7px] font-bold leading-none text-muted-foreground"
                      >
                        ?
                      </span>
                    ) : null}
                    <StageIcon
                      provider={stage.provider}
                      className={cn("relative z-[1] size-3.5", skipped && "opacity-40")}
                    />
                  </motion.span>

                  <span
                    className={cn(
                      "w-full px-0.5 text-center text-[10px] font-medium leading-tight",
                      isFocus && "text-foreground",
                      !isFocus && skipped && "text-muted-foreground/65",
                      !isFocus && !skipped && "text-muted-foreground",
                    )}
                  >
                    {stage.label}
                  </span>

                  {isOptional ? (
                    <span
                      className={cn(
                        "font-mono text-[8px] uppercase tracking-[0.14em]",
                        skipped
                          ? "text-muted-foreground/55"
                          : reached || isFocus
                            ? "text-primary/80"
                            : "text-muted-foreground/70",
                      )}
                    >
                      {skipped ? "skipped" : "optional"}
                    </span>
                  ) : (
                    <span className="h-[11px]" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
