"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { timelineBounds } from "@/lib/pipeline/studio";

const SPEEDS = [1, 2, 4] as const;
const REPLAY_STATE_STORAGE_PREFIX = "pipeline-replay-state";
const DEFAULT_REPLAY_STATE = { virtualMs: null, speed: 1 as (typeof SPEEDS)[number] };

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

  const bounds = useMemo(
    () => timelineBounds(timeline, runStartedAt, runEndedAt),
    [timeline, runStartedAt, runEndedAt],
  );

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

function getReplayStateStorageKey(runId: string) {
  return `${REPLAY_STATE_STORAGE_PREFIX}:${runId}`;
}

function safeStorageGet(key: string): string | null {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const value = storage.getItem(key);
      if (value != null) {
        return value;
      }
    } catch {
      // Storage may be blocked in strict browser privacy modes.
    }
  }
  return null;
}

function safeStorageSet(key: string, value: string) {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.setItem(key, value);
    } catch {
      // Keep trying alternate storage if one is unavailable.
    }
  }
}

function safeStorageRemove(key: string) {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.removeItem(key);
    } catch {
      // Best effort only.
    }
  }
}

type StoredReplayState = {
  virtualMs: number | null;
  speed: (typeof SPEEDS)[number];
};

function readStoredReplayState(runId: string | null, isLive: boolean): StoredReplayState {
  if (!runId || isLive || typeof window === "undefined") {
    return DEFAULT_REPLAY_STATE;
  }

  const raw = safeStorageGet(getReplayStateStorageKey(runId));
  if (!raw) {
    return DEFAULT_REPLAY_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredReplayState>;
    const speed =
      typeof parsed.speed === "number" &&
      SPEEDS.includes(parsed.speed as never) &&
      !Number.isNaN(parsed.speed)
        ? (parsed.speed as (typeof SPEEDS)[number])
        : DEFAULT_REPLAY_STATE.speed;
    const virtualMs: number | null =
      typeof parsed.virtualMs === "number"
        ? parsed.virtualMs
        : parsed.virtualMs === null
          ? null
          : DEFAULT_REPLAY_STATE.virtualMs;
    return { virtualMs, speed };
  } catch {
    safeStorageRemove(getReplayStateStorageKey(runId));
    return DEFAULT_REPLAY_STATE;
  }
}

export function useReplayState(runId: string | null, isLive: boolean) {
  const [playing, setPlaying] = useState(false);
  // Defaults only on first paint — localStorage is loaded after mount to avoid
  // SSR/client hydration mismatches.
  const [virtualMs, setVirtualMs] = useState<number | null>(DEFAULT_REPLAY_STATE.virtualMs);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(DEFAULT_REPLAY_STATE.speed);
  const virtualMsRef = useRef<number | null>(DEFAULT_REPLAY_STATE.virtualMs);
  const speedRef = useRef<(typeof SPEEDS)[number]>(DEFAULT_REPLAY_STATE.speed);

  useEffect(() => {
    const stored = readStoredReplayState(runId, isLive);
    virtualMsRef.current = stored.virtualMs;
    speedRef.current = stored.speed;
    // Defer so we don't sync-setState inside the effect body (React Compiler lint).
    const boot = window.setTimeout(() => {
      setVirtualMs(stored.virtualMs);
      setSpeed(stored.speed);
    }, 0);
    return () => window.clearTimeout(boot);
  }, [runId, isLive]);

  const persistNow = useCallback(() => {
    if (!runId || isLive || typeof window === "undefined") return;
    safeStorageSet(
      getReplayStateStorageKey(runId),
      JSON.stringify({
        virtualMs: virtualMsRef.current,
        speed: speedRef.current,
      } as StoredReplayState),
    );
  }, [isLive, runId]);

  const setVirtualMsPersist = useCallback((value: number | null) => {
    virtualMsRef.current = value;
    setVirtualMs(value);
    // Persist on pause / unload / blur — not every playhead tick.
  }, []);

  const setSpeedPersist = useCallback(
    (nextSpeed: (typeof SPEEDS)[number]) => {
      if (!SPEEDS.includes(nextSpeed as never)) return;
      speedRef.current = nextSpeed;
      setSpeed(nextSpeed);
      persistNow();
    },
    [persistNow],
  );

  useEffect(() => {
    if (!runId || isLive || typeof window === "undefined") return;
    virtualMsRef.current = virtualMs;
    speedRef.current = speed;
  }, [isLive, runId, virtualMs, speed]);

  useEffect(() => {
    if (!runId || isLive || typeof window === "undefined") return;

    const handleBeforeUnload = () => persistNow();
    const handleBlur = () => persistNow();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    };

    window.addEventListener("pagehide", persistNow, { capture: true });
    window.addEventListener("unload", persistNow);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("popstate", persistNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow, { capture: true });
      window.removeEventListener("unload", persistNow);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("popstate", persistNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isLive, runId, persistNow]);

  useEffect(() => {
    if (!playing) persistNow();
  }, [playing, persistNow]);

  return {
    playing: isLive ? false : playing,
    setPlaying,
    virtualMs: isLive ? null : virtualMs,
    setVirtualMs: setVirtualMsPersist,
    speed,
    setSpeed: setSpeedPersist,
  };
}
