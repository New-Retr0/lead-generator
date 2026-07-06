"use client";

import { memo } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { providerColor } from "@/lib/pipeline/stages";

export type PipelineEdgeData = {
  provider?: string;
  reducedMotion?: boolean;
  particles?: Array<{ id: string; provider: string }>;
};

export type PipelineEdgeType = Edge<PipelineEdgeData, "pipelineEdge">;

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
  const particles = data?.particles ?? [];

  return (
    <>
      <BaseEdge id={id} path={edgePath} className="stroke-border/70" />
      {!reducedMotion
        ? particles.map((particle) => (
            <circle key={particle.id} r={4} fill={providerColor(particle.provider)}>
              <animateMotion dur="1.2s" repeatCount="1" path={edgePath} fill="freeze" />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                dur="1.2s"
                repeatCount="1"
              />
            </circle>
          ))
        : null}
    </>
  );
}

export const PipelineEdge = memo(PipelineEdgeComponent);
