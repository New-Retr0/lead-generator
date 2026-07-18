"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Bot, Flame, Globe, MapPin, Workflow } from "lucide-react";
import { Odometer } from "@/components/animated";
import { duration, EASE, liveState, spring } from "@/components/console/motion";
import { Badge } from "@/components/ui/badge";
import { cn, formatUsdCompact } from "@/lib/utils";
import type { CostGroup, StageStat } from "@/lib/pipeline/rollup";
import {
  getStageDef,
  providerColor,
  type PipelineProvider,
} from "@/lib/pipeline/stages";

export type PipelineNodeData = {
  stageId: string;
  stat?: StageStat;
  rollup?: CostGroup;
  active?: boolean;
  skipped?: boolean;
  reducedMotion?: boolean;
  pulseKey?: number;
};

function StageIcon({ provider }: { provider: PipelineProvider | string }) {
  switch (provider) {
    case "firecrawl":
      return <Flame className="size-3.5" />;
    case "browser_use":
      return <Bot className="size-3.5" />;
    case "google_places":
      return <MapPin className="size-3.5" />;
    case "system":
      return <Workflow className="size-3.5" />;
    default:
      return <Globe className="size-3.5" />;
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export type PipelineNodeType = Node<PipelineNodeData, "pipelineNode">;

function PipelineNodeComponent({ data }: NodeProps<PipelineNodeType>) {
  const def = getStageDef(data.stageId);
  const provider = def?.provider ?? "system";
  const accent = providerColor(provider);
  const usd = data.rollup?.usd ?? data.stat?.usd ?? 0;
  const credits = data.stat?.credits ?? 0;
  const eventCount = data.stat?.eventCount ?? data.rollup?.eventCount ?? 0;
  const avgMs = data.stat?.avgDurationMs ?? data.rollup?.avgDurationMs;
  const pulse = (data.pulseKey ?? 0) > 0 && !data.reducedMotion;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-2 !border-background !bg-muted-foreground/40"
      />
      <motion.div
        key={data.pulseKey ?? 0}
        initial={false}
        animate={
          pulse
            ? {
                scale: [...liveState.pulseOnce.scale],
                transition: liveState.pulseOnce.transition,
              }
            : { scale: 1 }
        }
        transition={{ duration: duration.normal, ease: EASE }}
        className="relative"
      >
        {data.active && !data.reducedMotion ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-xl"
            style={{
              background: `radial-gradient(circle at 50% 0%, ${accent}33, transparent 70%)`,
            }}
            animate={{ opacity: [0.35, 0.75, 0.35] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}

        <div
          className={cn(
            "relative w-[156px] overflow-hidden rounded-xl border bg-card/90 shadow-sm backdrop-blur-sm transition-opacity",
            data.skipped && "opacity-40",
            data.active && "border-primary/45 shadow-[0_0_28px_-14px_rgba(255,92,57,0.85)]",
          )}
          style={{ borderTopColor: accent, borderTopWidth: 3 }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-10 opacity-40"
            style={{
              background: `linear-gradient(180deg, ${accent}22, transparent)`,
            }}
          />

          <div className="relative space-y-1.5 p-2.5">
            <div className="flex items-start gap-1.5">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/80"
                style={{ color: accent }}
              >
                <StageIcon provider={provider} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold leading-tight tracking-tight">
                  {def?.label ?? data.stageId}
                </p>
                {def?.conditional ? (
                  <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px]">
                    conditional
                  </Badge>
                ) : null}
              </div>
              {data.active ? (
                <motion.span
                  className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
                  animate={
                    data.reducedMotion
                      ? undefined
                      : { scale: [1, 1.35, 1], opacity: [0.7, 1, 0.7] }
                  }
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                />
              ) : null}
            </div>

            <div className="flex items-baseline justify-between gap-1 border-t border-border/40 pt-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                usd
              </span>
              <Odometer
                value={usd}
                format={(n) => formatUsdCompact(n)}
                className="text-xs font-bold"
                climbSeconds={0.8}
              />
            </div>

            <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
              <span className="tabular-nums">
                {eventCount} evt
                {credits > 0 ? ` · ${credits.toLocaleString()} cr` : ""}
              </span>
              <motion.span
                layout
                className="rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] tabular-nums"
                transition={spring.soft}
              >
                {formatDuration(avgMs)}
              </motion.span>
            </div>
          </div>
        </div>
      </motion.div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-background !bg-muted-foreground/40"
      />
    </>
  );
}

export const PipelineNode = memo(PipelineNodeComponent);
