"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import { ChartContainer } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StageStat } from "@/lib/pipeline/rollup";
import type { PipelineTimelineEntry } from "@/lib/pipeline/stages";

const SPEEDS = [1, 4, 16, 60] as const;

function formatClock(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ReplayControls({
  timeline,
  runStartedAt,
  runEndedAt,
  playing,
  onPlayingChange,
  virtualMs,
  onVirtualMsChange,
  speed,
  onSpeedChange,
  stageStats,
}: {
  timeline: PipelineTimelineEntry[];
  runStartedAt: string | null;
  runEndedAt: string | null;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;
  virtualMs: number | null;
  onVirtualMsChange: (ms: number | null) => void;
  speed: (typeof SPEEDS)[number];
  onSpeedChange: (v: (typeof SPEEDS)[number]) => void;
  stageStats: Map<string, StageStat>;
}) {
  const rafRef = useRef<number | null>(null);
  const lastTick = useRef<number | null>(null);

  const bounds = useMemo(() => {
    if (timeline.length === 0) {
      // eslint-disable-next-line react-hooks/purity -- fallback window when timeline empty
      const start = runStartedAt ? new Date(runStartedAt).getTime() : Date.now();
      const end = runEndedAt ? new Date(runEndedAt).getTime() : start + 60_000;
      return { start, end: Math.max(end, start + 1000) };
    }
    const start = new Date(timeline[0].ts).getTime();
    const end = new Date(timeline[timeline.length - 1].ts).getTime();
    return { start, end: Math.max(end, start + 1000) };
  }, [timeline, runStartedAt, runEndedAt]);

  const currentMs = virtualMs ?? bounds.end;
  const progress =
    bounds.end > bounds.start
      ? ((currentMs - bounds.start) / (bounds.end - bounds.start)) * 100
      : 100;

  useEffect(() => {
    if (!playing) {
      lastTick.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = (now: number) => {
      if (lastTick.current == null) lastTick.current = now;
      const delta = now - lastTick.current;
      lastTick.current = now;
      const next = Math.min(
        bounds.end,
        (virtualMs ?? bounds.start) + delta * speed,
      );
      onVirtualMsChange(next);
      if (next >= bounds.end) {
        onPlayingChange(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [
    playing,
    speed,
    bounds.end,
    bounds.start,
    virtualMs,
    onVirtualMsChange,
    onPlayingChange,
  ]);

  const slowest = useMemo(() => {
    return [...stageStats.values()]
      .filter((s) => s.avgDurationMs != null && s.avgDurationMs > 0)
      .sort((a, b) => (b.avgDurationMs ?? 0) - (a.avgDurationMs ?? 0))
      .slice(0, 5)
      .map((s) => ({
        stage: s.stage,
        ms: s.avgDurationMs ?? 0,
      }));
  }, [stageStats]);

  if (timeline.length === 0 && !runStartedAt) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a completed run to replay its timeline.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <ToggleGroup
          type="single"
          value={String(speed)}
          onValueChange={(v) => {
            if (v) onSpeedChange(Number(v) as (typeof SPEEDS)[number]);
          }}
        >
          {SPEEDS.map((s) => (
            <ToggleGroupItem key={s} value={String(s)} size="sm" className="px-2 text-xs">
              {s}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Badge variant="outline" className="font-mono text-xs">
          {formatClock(currentMs - bounds.start)} / {formatClock(bounds.end - bounds.start)}
        </Badge>
      </div>

      <Slider
        value={[progress]}
        min={0}
        max={100}
        step={0.1}
        onValueChange={([v]) => {
          onPlayingChange(false);
          const ms = bounds.start + ((bounds.end - bounds.start) * v) / 100;
          onVirtualMsChange(ms);
        }}
      />

      {slowest.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Slowest stages (avg)
          </p>
          <ChartContainer
            config={{ ms: { label: "Duration", color: "var(--chart-2)" } }}
            className="h-24"
          >
            <BarChart data={slowest} layout="vertical" margin={{ left: 4, right: 4 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="stage"
                width={88}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => String(v).replace(/_/g, " ")}
              />
              <Bar dataKey="ms" fill="var(--chart-2)" radius={3} animationDuration={600} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : null}
    </div>
  );
}

export function useReplayState(isLive: boolean) {
  const [playing, setPlaying] = useState(false);
  const [virtualMs, setVirtualMs] = useState<number | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);

  useEffect(() => {
    if (isLive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset replay when live
      setPlaying(false);
      setVirtualMs(null);
    }
  }, [isLive]);

  return {
    playing: isLive ? false : playing,
    setPlaying,
    virtualMs: isLive ? null : virtualMs,
    setVirtualMs,
    speed,
    setSpeed,
  };
}
