"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { duration, EASE } from "@/components/console/motion";
import { SpringUsd } from "@/components/pipeline/spring-usd";
import { getStageDef, providerColor, type PipelineCostEvent } from "@/lib/pipeline/stages";
import { rollupCosts } from "@/lib/pipeline/rollup";
import { stageLabel } from "@/lib/pipeline/studio";
import { cn } from "@/lib/utils";

/** Compact stacked spend bar — wraps cleanly, no horizontal clip. */
export function PipelineSpendReel({
  costs,
  focusStageId,
  onFocusStage,
}: {
  costs: PipelineCostEvent[];
  focusStageId: string;
  onFocusStage: (stageId: string) => void;
  playing?: boolean;
}) {
  const reduced = useSafeReducedMotion();
  const groups = useMemo(() => rollupCosts(costs, 2), [costs]);
  const totalUsd = useMemo(
    () => groups.reduce((sum, g) => sum + g.usd, 0),
    [groups],
  );

  if (groups.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">No spend at this moment.</p>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/70">
        {groups.map((group) => {
          const pct = (group.usd / Math.max(totalUsd, 0.0001)) * 100;
          if (pct < 0.5) return null;
          const accent = providerColor(getStageDef(group.key)?.provider ?? "system");
          const hot = group.key === focusStageId;
          return (
            <motion.button
              key={group.key}
              type="button"
              title={`${stageLabel(group.key)} · $${group.usd.toFixed(4)}`}
              className="h-full min-w-[2px] border-r border-background/50 last:border-r-0"
              style={{
                flexGrow: pct,
                flexBasis: 0,
                background: accent,
                opacity: hot ? 1 : 0.65,
              }}
              initial={false}
              transition={
                reduced ? { duration: 0 } : { duration: duration.slow, ease: EASE }
              }
              onClick={() => onFocusStage(group.key)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {groups.map((group) => {
          const accent = providerColor(getStageDef(group.key)?.provider ?? "system");
          const hot = group.key === focusStageId;
          const digits = group.usd > 0 && group.usd < 0.01 ? 4 : group.usd < 1 ? 3 : 2;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => onFocusStage(group.key)}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 text-[10px]",
                hot ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: accent }}
              />
              <span className="truncate">{stageLabel(group.key)}</span>
              <SpringUsd
                value={group.usd}
                digits={digits}
                stiffness={70}
                damping={20}
                className="shrink-0 text-[10px] text-foreground/80"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
