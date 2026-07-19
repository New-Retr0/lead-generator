"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { duration, EASE } from "@/components/console/motion";
import type { PipelineProvider } from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

export type SignalKind = "scrape" | "search" | "network" | "extract" | "idle";

export function signalKindFor(
  stageId: string,
  provider: PipelineProvider | string,
): SignalKind {
  if (provider === "system") return "idle";
  if (provider === "google_places") return "network";
  if (provider === "browser_use") return "scrape";

  if (
    stageId.includes("search") ||
    stageId.includes("linkedin") ||
    stageId === "bbb" ||
    stageId === "state_license" ||
    stageId === "leasing"
  ) {
    return "search";
  }
  if (stageId === "map" || stageId === "website_resolve" || stageId === "owner_chain") {
    return "network";
  }
  return "scrape";
}

const LABELS: Record<SignalKind, string> = {
  scrape: "scraping",
  search: "searching",
  network: "request",
  extract: "extracting",
  idle: "idle",
};

function ScrapeGlyph({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="overflow-visible">
      <rect
        x="2.5"
        y="1.5"
        width="9"
        height="11"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
      {[4, 6.5, 9].map((y, i) => (
        <motion.line
          key={y}
          x1="4.5"
          x2="9.5"
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          initial={false}
          animate={
            active
              ? { opacity: [0.25, 0.9, 0.25], pathLength: [0.4, 1, 0.4] }
              : { opacity: 0.35 }
          }
          transition={
            active
              ? { duration: 1.4, delay: i * 0.18, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        />
      ))}
      {active ? (
        <motion.rect
          x="2.5"
          width="9"
          height="1.4"
          rx="0.5"
          fill="currentColor"
          animate={{ y: [2, 10.5, 2], opacity: [0.15, 0.45, 0.15] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
    </svg>
  );
}

function SearchGlyph({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <motion.circle
        cx="6"
        cy="6"
        r="3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        animate={active ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.5 }}
        transition={
          active ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }
        }
      />
      <path
        d="M8.4 8.4 L11.2 11.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      {active ? (
        <motion.circle
          cx="6"
          cy="6"
          r="3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: [0, 1, 0], opacity: [0, 0.7, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
    </svg>
  );
}

function NetworkGlyph({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="overflow-visible">
      <circle cx="3" cy="7" r="1.35" fill="currentColor" opacity="0.85" />
      <circle cx="11" cy="7" r="1.35" fill="currentColor" opacity="0.85" />
      <line
        x1="4.4"
        y1="7"
        x2="9.6"
        y2="7"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.3"
      />
      {active ? (
        <motion.circle
          r="1.1"
          fill="currentColor"
          initial={{ cx: 4.2, opacity: 0 }}
          animate={{ cx: [4.2, 9.8], opacity: [0, 1, 0] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: "easeInOut" }}
          cy="7"
        />
      ) : null}
      {active ? (
        <>
          <motion.path
            d="M3 7 C 5 3.5, 9 3.5, 11 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
            animate={{ opacity: [0.15, 0.55, 0.15] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.path
            d="M3 7 C 5 10.5, 9 10.5, 11 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
            animate={{ opacity: [0.1, 0.4, 0.1] }}
            transition={{ duration: 2, delay: 0.35, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      ) : null}
    </svg>
  );
}

function ExtractGlyph({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={3.5 + i * 3.5}
          cy="7"
          r="1.15"
          fill="currentColor"
          animate={
            active
              ? { opacity: [0.25, 1, 0.25], y: [0, -1.2, 0] }
              : { opacity: 0.4 }
          }
          transition={
            active
              ? { duration: 1.1, delay: i * 0.16, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        />
      ))}
    </svg>
  );
}

function SignalGlyph({ kind, active }: { kind: SignalKind; active: boolean }) {
  switch (kind) {
    case "scrape":
      return <ScrapeGlyph active={active} />;
    case "search":
      return <SearchGlyph active={active} />;
    case "network":
      return <NetworkGlyph active={active} />;
    case "extract":
      return <ExtractGlyph active={active} />;
    case "idle":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.35" />
        </svg>
      );
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Tiny non-intrusive scrape / network activity chip for Pipeline Studio.
 */
export function PipelineSignal({
  stageId,
  provider,
  active,
  className,
}: {
  stageId: string;
  provider: PipelineProvider | string;
  /** Animate when the film is moving or live. */
  active: boolean;
  className?: string;
}) {
  const reduced = useSafeReducedMotion();
  const kind = signalKindFor(stageId, provider);
  const show = kind !== "idle";
  const animating = active && !reduced && show;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {show ? (
        <motion.span
          key={kind}
          initial={reduced ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: duration.fast, ease: EASE }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5",
            "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
            animating && "border-primary/25 text-foreground/80",
            className,
          )}
          style={animating ? { color: "var(--primary)" } : undefined}
          title={LABELS[kind]}
        >
          <SignalGlyph kind={kind} active={animating} />
          <span className={cn(!animating && "opacity-70")}>{LABELS[kind]}</span>
          {animating ? (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40" />
              <span className="relative inline-flex size-1.5 rounded-full bg-current" />
            </span>
          ) : null}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
