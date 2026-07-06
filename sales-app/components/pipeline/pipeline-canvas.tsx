"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { StageStat } from "@/lib/pipeline/rollup";
import type { CostGroup } from "@/lib/pipeline/rollup";
import {
  PIPELINE_STAGES,
  STAGE_EDGES,
  eventToStage,
  getStageDef,
  type PipelineTimelineEntry,
} from "@/lib/pipeline/stages";
import { PipelineEdge, type PipelineEdgeData } from "./pipeline-edge";
import { PipelineNode, type PipelineNodeData } from "./pipeline-node";

const nodeTypes = { pipelineNode: PipelineNode } satisfies NodeTypes;
const edgeTypes = { pipelineEdge: PipelineEdge } satisfies EdgeTypes;

const MAX_PARTICLES = 30;

function edgeForStages(source: string, target: string): string | null {
  const edge = STAGE_EDGES.find((e) => e.source === source && e.target === target);
  return edge?.id ?? null;
}

function resolveEdgeId(entry: PipelineTimelineEntry): string | null {
  if (entry.kind === "cost") {
    const stage = entry.cost.stage;
    const def = getStageDef(stage);
    if (!def) return null;
    const idx = PIPELINE_STAGES.findIndex((s) => s.id === stage);
    if (idx <= 0) return STAGE_EDGES.find((e) => e.target === stage)?.id ?? null;
    const prev = PIPELINE_STAGES[idx - 1]?.id;
    return prev ? edgeForStages(prev, stage) : null;
  }
  const stage = eventToStage(entry.event);
  if (!stage) return null;
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === stage);
  if (idx <= 0) return STAGE_EDGES.find((e) => e.target === stage)?.id ?? null;
  const prev = PIPELINE_STAGES[idx - 1]?.id;
  return prev ? edgeForStages(prev, stage) : null;
}

export function PipelineCanvas({
  stageStats,
  stageRollup,
  timeline,
  replayUpToMs,
  activeStages,
  reducedMotion,
}: {
  stageStats: Map<string, StageStat>;
  stageRollup: Map<string, CostGroup>;
  timeline: PipelineTimelineEntry[];
  replayUpToMs: number | null;
  activeStages: Set<string>;
  reducedMotion: boolean;
}) {
  const [particlesByEdge, setParticlesByEdge] = useState<
    Record<string, Array<{ id: string; provider: string }>>
  >({});
  const seenTimeline = useRef(0);
  const pulseKeys = useRef<Record<string, number>>({});

  const visibleTimeline = useMemo(() => {
    if (replayUpToMs == null) return timeline;
    return timeline.filter((e) => new Date(e.ts).getTime() <= replayUpToMs);
  }, [timeline, replayUpToMs]);

  useEffect(() => {
    if (visibleTimeline.length <= seenTimeline.current) {
      if (replayUpToMs != null && visibleTimeline.length < seenTimeline.current) {
        seenTimeline.current = 0;
        setParticlesByEdge({});
      }
      return;
    }
    const fresh = visibleTimeline.slice(seenTimeline.current);
    seenTimeline.current = visibleTimeline.length;

    setParticlesByEdge((prev) => {
      const next = { ...prev };
      for (const entry of fresh) {
        const edgeId = resolveEdgeId(entry);
        if (!edgeId) continue;
        const provider =
          entry.kind === "cost"
            ? entry.cost.provider
            : getStageDef(eventToStage(entry.event) ?? "")?.provider ?? "system";
        const list = [...(next[edgeId] ?? [])];
        list.push({ id: `${edgeId}-${entry.ts}-${list.length}`, provider });
        next[edgeId] = list.slice(-MAX_PARTICLES);

        const stage =
          entry.kind === "cost"
            ? entry.cost.stage
            : eventToStage(entry.event) ?? "";
        if (stage) {
          pulseKeys.current[stage] = (pulseKeys.current[stage] ?? 0) + 1;
        }
      }
      return next;
    });
  }, [visibleTimeline, replayUpToMs]);

  const nodes: Node<PipelineNodeData, "pipelineNode">[] = useMemo(
    () =>
      PIPELINE_STAGES.map((stage) => ({
        id: stage.id,
        type: "pipelineNode",
        position: stage.position,
        data: {
          stageId: stage.id,
          stat: stageStats.get(stage.id),
          rollup: stageRollup.get(stage.id),
          active: activeStages.has(stage.id),
          skipped: stage.conditional && !activeStages.has(stage.id) && visibleTimeline.length > 0,
          reducedMotion,
          pulseKey: pulseKeys.current[stage.id] ?? 0,
        },
      })),
    [stageStats, stageRollup, activeStages, reducedMotion, visibleTimeline.length],
  );

  const edges: Edge<PipelineEdgeData>[] = useMemo(
    () =>
      STAGE_EDGES.map((edge) => {
        const targetDef = getStageDef(edge.target);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "pipelineEdge",
          data: {
            provider: targetDef?.provider,
            reducedMotion,
            particles: particlesByEdge[edge.id] ?? [],
          },
        };
      }),
    [particlesByEdge, reducedMotion],
  );

  return (
    <div className="h-[420px] w-full min-w-0 rounded-lg border bg-muted/20 lg:h-[520px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card/90" />
      </ReactFlow>
    </div>
  );
}
