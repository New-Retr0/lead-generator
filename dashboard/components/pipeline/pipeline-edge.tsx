"use client";

import { memo } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { duration } from "@/components/console/motion";
import { providerColor } from "@/lib/pipeline/stages";

export type PipelineEdgeData = {
  provider?: string;
  reducedMotion?: boolean;
  particles?: Array<{ id: string; provider: string }>;
  active?: boolean;
};

export type PipelineEdgeType = Edge<PipelineEdgeData, "pipelineEdge">;

const PARTICLE_DUR = `${duration.particle}s`;

function PipelineEdgeComponent(props: EdgeProps<PipelineEdgeType>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const reducedMotion = data?.reducedMotion ?? false;
  const particles = reducedMotion ? [] : (data?.particles ?? []);
  const accent = providerColor(data?.provider ?? "system");
  const active = Boolean(data?.active) || particles.length > 0;
  const gradientId = `pipe-edge-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={accent} stopOpacity={active ? 0.15 : 0.08} />
          <stop offset="50%" stopColor={accent} stopOpacity={active ? 0.55 : 0.2} />
          <stop offset="100%" stopColor={accent} stopOpacity={active ? 0.15 : 0.08} />
        </linearGradient>
      </defs>

      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          stroke: accent,
          strokeWidth: active ? 6 : 3,
          opacity: active ? 0.18 : 0.06,
          filter: active ? "blur(2px)" : undefined,
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: active ? 2.25 : 1.5,
          strokeDasharray: active && !reducedMotion ? "6 8" : undefined,
        }}
        className={active && !reducedMotion ? "pipeline-edge-flow" : undefined}
      />

      {particles.map((particle) => (
        <g key={particle.id}>
          <circle r={6} fill={providerColor(particle.provider)} opacity={0.22}>
            <animateMotion dur={PARTICLE_DUR} repeatCount="1" path={edgePath} fill="remove" />
            <animate
              attributeName="opacity"
              values="0;0.35;0.2;0"
              dur={PARTICLE_DUR}
              repeatCount="1"
              fill="remove"
            />
          </circle>
          <circle r={3.5} fill={providerColor(particle.provider)}>
            <animateMotion dur={PARTICLE_DUR} repeatCount="1" path={edgePath} fill="remove" />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur={PARTICLE_DUR}
              repeatCount="1"
              fill="remove"
            />
          </circle>
        </g>
      ))}
    </>
  );
}

export const PipelineEdge = memo(PipelineEdgeComponent);
