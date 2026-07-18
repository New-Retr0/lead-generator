"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { liveState } from "@/components/console/motion";
import type { StageStat } from "@/lib/pipeline/rollup";
import type { CostGroup } from "@/lib/pipeline/rollup";
import {
  PIPELINE_STAGES,
  STAGE_EDGES,
  eventToStage,
  getStageDef,
  providerColor,
  type PipelineTimelineEntry,
} from "@/lib/pipeline/stages";
import { PipelineEdge, type PipelineEdgeData } from "./pipeline-edge";
import { PipelineNode, type PipelineNodeData } from "./pipeline-node";

const nodeTypes = { pipelineNode: PipelineNode } satisfies NodeTypes;
const edgeTypes = { pipelineEdge: PipelineEdge } satisfies EdgeTypes;

type PipelineFlowNode = Node<PipelineNodeData, "pipelineNode">;
type PipelineFlowEdge = Edge<PipelineEdgeData>;

const MAX_PARTICLES_GLOBAL = liveState.maxParticlesGlobal;
const MAX_PARTICLES_PER_EDGE = liveState.maxParticlesPerEdge;
const PARTICLE_TTL_MS = liveState.particleMs;

type Particle = { id: string; provider: string; createdAt: number };

function resolveEdgeId(
  entry: PipelineTimelineEntry,
  seenStages: Set<string>,
): string | null {
  const stage =
    entry.kind === "cost" ? entry.cost.stage : eventToStage(entry.event);
  if (!stage) return null;

  const incoming = STAGE_EDGES.filter((edge) => edge.target === stage);
  if (incoming.length === 0) return null;
  if (incoming.length === 1) return incoming[0].id;

  const fromSeen = incoming.find((edge) => seenStages.has(edge.source));
  if (fromSeen) return fromSeen.id;

  const main = incoming.find((edge) => !edge.conditional);
  return (main ?? incoming[0]).id;
}

function FitOnce({ enabled }: { enabled: boolean }) {
  const { fitView } = useReactFlow();
  const fitted = useRef(false);

  useEffect(() => {
    if (!enabled || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 0 });
    });
  }, [enabled, fitView]);

  return null;
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
  const [particlesByEdge, setParticlesByEdge] = useState<Record<string, Particle[]>>({});
  const seenTimeline = useRef(0);
  const seenStages = useRef(new Set<string>());
  const [pulseKeys, setPulseKeys] = useState<Record<string, number>>({});
  const [flowReady, setFlowReady] = useState(false);

  const visibleTimeline = useMemo(() => {
    if (replayUpToMs == null) return timeline;
    return timeline.filter((e) => new Date(e.ts).getTime() <= replayUpToMs);
  }, [timeline, replayUpToMs]);

  useEffect(() => {
    if (visibleTimeline.length <= seenTimeline.current) {
      if (replayUpToMs != null && visibleTimeline.length < seenTimeline.current) {
        seenTimeline.current = 0;
        seenStages.current = new Set();
        setParticlesByEdge({});
        setPulseKeys({});
      }
      return;
    }
    const fresh = visibleTimeline.slice(seenTimeline.current);
    seenTimeline.current = visibleTimeline.length;

    if (reducedMotion) {
      for (const entry of fresh) {
        const stage =
          entry.kind === "cost"
            ? entry.cost.stage
            : eventToStage(entry.event) ?? "";
        if (stage) seenStages.current.add(stage);
      }
      setPulseKeys((prev) => {
        const next = { ...prev };
        for (const entry of fresh) {
          const stage =
            entry.kind === "cost"
              ? entry.cost.stage
              : eventToStage(entry.event) ?? "";
          if (stage) next[stage] = (next[stage] ?? 0) + 1;
        }
        return next;
      });
      return;
    }

    const now = Date.now();
    setParticlesByEdge((prev) => {
      const next: Record<string, Particle[]> = {};
      for (const [edgeId, list] of Object.entries(prev)) {
        const kept = list.filter((p) => now - p.createdAt < PARTICLE_TTL_MS);
        if (kept.length) next[edgeId] = kept;
      }

      for (const entry of fresh) {
        const edgeId = resolveEdgeId(entry, seenStages.current);
        const stage =
          entry.kind === "cost"
            ? entry.cost.stage
            : eventToStage(entry.event) ?? "";
        if (stage) seenStages.current.add(stage);
        if (!edgeId) continue;

        const provider =
          entry.kind === "cost"
            ? entry.cost.provider
            : getStageDef(stage)?.provider ?? "system";
        const list = [...(next[edgeId] ?? [])];
        list.push({
          id: `${edgeId}-${entry.ts}-${list.length}-${now}`,
          provider,
          createdAt: now,
        });
        next[edgeId] = list.slice(-MAX_PARTICLES_PER_EDGE);
      }

      const flat = Object.entries(next).flatMap(([edgeId, list]) =>
        list.map((p) => ({ edgeId, p })),
      );
      if (flat.length > MAX_PARTICLES_GLOBAL) {
        flat.sort((a, b) => a.p.createdAt - b.p.createdAt);
        const keep = new Set(
          flat.slice(-MAX_PARTICLES_GLOBAL).map((item) => item.p.id),
        );
        for (const edgeId of Object.keys(next)) {
          next[edgeId] = next[edgeId].filter((p) => keep.has(p.id));
          if (next[edgeId].length === 0) delete next[edgeId];
        }
      }

      return next;
    });

    setPulseKeys((prev) => {
      const next = { ...prev };
      for (const entry of fresh) {
        const stage =
          entry.kind === "cost"
            ? entry.cost.stage
            : eventToStage(entry.event) ?? "";
        if (stage) next[stage] = (next[stage] ?? 0) + 1;
      }
      return next;
    });
  }, [visibleTimeline, replayUpToMs, reducedMotion]);

  // Drop expired particles after TTL so SVG circles don't linger.
  useEffect(() => {
    if (reducedMotion) return;
    const hasParticles = Object.keys(particlesByEdge).length > 0;
    if (!hasParticles) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setParticlesByEdge((prev) => {
        let changed = false;
        const next: Record<string, Particle[]> = {};
        for (const [edgeId, list] of Object.entries(prev)) {
          const kept = list.filter((p) => now - p.createdAt < PARTICLE_TTL_MS);
          if (kept.length !== list.length) changed = true;
          if (kept.length) next[edgeId] = kept;
        }
        return changed ? next : prev;
      });
    }, PARTICLE_TTL_MS + 50);
    return () => window.clearTimeout(timer);
  }, [particlesByEdge, reducedMotion]);

  const onInit = useCallback(() => {
    setFlowReady(true);
  }, []);

  const nodes: PipelineFlowNode[] = useMemo(
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
          pulseKey: pulseKeys[stage.id] ?? 0,
        },
      })),
    [stageStats, stageRollup, activeStages, reducedMotion, visibleTimeline.length, pulseKeys],
  );

  const edges: PipelineFlowEdge[] = useMemo(
    () =>
      STAGE_EDGES.map((edge) => {
        const targetDef = getStageDef(edge.target);
        const particles = (particlesByEdge[edge.id] ?? []).map(({ id, provider }) => ({
          id,
          provider,
        }));
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "pipelineEdge",
          data: {
            provider: targetDef?.provider,
            reducedMotion,
            active: activeStages.has(edge.target) || particles.length > 0,
            particles,
          },
        };
      }),
    [particlesByEdge, reducedMotion, activeStages],
  );

  return (
    <div className="pipeline-studio relative h-[420px] w-full min-w-0 overflow-hidden rounded-xl border border-border/60 lg:h-[520px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(255,92,57,0.12),transparent_55%),radial-gradient(ellipse_at_80%_100%,rgba(26,26,26,0.06),transparent_50%),linear-gradient(180deg,color-mix(in_oklab,var(--muted)_55%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(26,26,26,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(26,26,26,0.04)_1px,transparent_1px)] [background-size:28px_28px]"
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit}
        minZoom={0.2}
        maxZoom={1.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        // Viewport is fitted once via FitOnce — do not re-zoom on live ticks.
        fitView={false}
        className="!bg-transparent"
      >
        <FitOnce enabled={flowReady && nodes.length > 0} />
        <Background gap={28} size={1.2} color="rgba(26,26,26,0.06)" />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border-border/60 !bg-card/90 !shadow-sm backdrop-blur-sm"
        />
        <MiniMap
          pannable
          zoomable
          className="!hidden !overflow-hidden !rounded-lg !border-border/60 !bg-card/90 md:!block"
          maskColor="rgba(250,250,249,0.72)"
          nodeColor={(node) => {
            const stageId = String(node.id);
            const def = getStageDef(stageId);
            return def ? providerColor(def.provider) : "#a3a3a3";
          }}
        />
      </ReactFlow>
    </div>
  );
}
