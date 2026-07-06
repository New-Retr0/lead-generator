"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Bot, Globe, Sparkles, Workflow } from "lucide-react";
import { Odometer } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StageStat } from "@/lib/pipeline/rollup";
import type { CostGroup } from "@/lib/pipeline/rollup";
import {
  getStageDef,
  providerColor,
  type PipelineProvider,
} from "@/lib/pipeline/stages";
import { formatUsdCompact } from "@/lib/utils";

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
  if (provider === "firecrawl") return <Globe className="size-3.5" />;
  if (provider === "ai_gateway") return <Sparkles className="size-3.5" />;
  if (provider === "browser_use") return <Bot className="size-3.5" />;
  if (provider === "google_places") return <Globe className="size-3.5" />;
  return <Workflow className="size-3.5" />;
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
  const usd = data.rollup?.usd ?? data.stat?.usd ?? 0;
  const credits = data.stat?.credits ?? 0;
  const eventCount = data.stat?.eventCount ?? data.rollup?.eventCount ?? 0;
  const avgMs = data.stat?.avgDurationMs ?? data.rollup?.avgDurationMs;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border !border-muted" />
      <motion.div
        animate={
          data.active && !data.reducedMotion
            ? { scale: [1, 1.04, 1] }
            : { scale: 1 }
        }
        transition={{ duration: 0.45 }}
        key={data.pulseKey}
      >
        <Card
          className={cn(
            "w-[148px] border shadow-sm transition-opacity",
            data.skipped && "opacity-40",
            data.active && "border-primary/50 shadow-[0_0_0_1px_oklch(var(--primary)/0.25)]",
          )}
          style={{ borderTopColor: providerColor(provider), borderTopWidth: 3 }}
        >
          <CardHeader className="gap-1 p-2 pb-0">
            <CardTitle className="flex items-center gap-1.5 text-[11px] font-semibold leading-tight">
              <span style={{ color: providerColor(provider) }}>
                <StageIcon provider={provider} />
              </span>
              <span className="truncate">{def?.label ?? data.stageId}</span>
            </CardTitle>
            {def?.conditional ? (
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                conditional
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-1">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                USD
              </span>
              <Odometer
                value={usd}
                format={(n) => formatUsdCompact(n)}
                className="text-xs font-bold"
                climbSeconds={0.8}
              />
            </div>
            {credits > 0 ? (
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {credits.toLocaleString()} cr
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
              <span>{eventCount} evt</span>
              <Badge variant="secondary" className="h-4 px-1 font-mono text-[9px]">
                {formatDuration(avgMs)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <Handle type="source" position={Position.Right} className="!bg-border !border-muted" />
    </>
  );
}

export const PipelineNode = memo(PipelineNodeComponent);
