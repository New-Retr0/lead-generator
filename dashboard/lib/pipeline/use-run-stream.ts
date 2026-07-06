"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runEventRowToJobEvent } from "@/lib/run-events";
import type { JobEvent } from "@/lib/types";

export type RunStreamCost = {
  id: number;
  usd: number;
  provider: string;
  operation: string;
  model: string | null;
  units: number;
  unit_type: string;
  place_id: string | null;
  meta_json: unknown;
  created_at: string;
};

export type RunStreamState = {
  events: JobEvent[];
  costs: RunStreamCost[];
  totalUsd: number;
  usdPerMinute: number;
  connected: boolean;
  loading: boolean;
};

function mergeEvents(prev: JobEvent[], incoming: JobEvent[], seen: Set<string>): JobEvent[] {
  const next = [...prev];
  for (const evt of incoming) {
    const key = `${evt.ts}:${evt.event}:${evt.place_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(evt);
  }
  return next;
}

function mergeCosts(prev: RunStreamCost[], incoming: RunStreamCost[], seen: Set<number>): RunStreamCost[] {
  const next = [...prev];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    next.push(row);
  }
  return next;
}

export function useRunStream(
  runId: string | null,
  options?: { enabled?: boolean; pollWhileRunning?: boolean },
): RunStreamState {
  const enabled = options?.enabled ?? true;
  const pollWhileRunning = options?.pollWhileRunning ?? true;
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [costs, setCosts] = useState<RunStreamCost[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(Boolean(runId && enabled));
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const seenEventKeys = useRef(new Set<string>());
  const seenCostIds = useRef(new Set<number>());
  const [windowStartMs, setWindowStartMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const fetchStream = useMemo(
    () => async () => {
      if (!runId) return;
      const [eventRes, costRes, runRes] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(runId)}/events`),
        fetch(`/api/runs/${encodeURIComponent(runId)}/costs`),
        fetch(`/api/runs/${encodeURIComponent(runId)}`),
      ]);
      const eventBody = (await eventRes.json()) as { events?: Record<string, unknown>[] };
      const costBody = (await costRes.json()) as { events?: Record<string, unknown>[] };
      const runBody = (await runRes.json()) as { run?: { status?: string } };

      setRunStatus(runBody.run?.status ?? null);

      const incomingEvents: JobEvent[] = [];
      for (const row of eventBody.events ?? []) {
        incomingEvents.push(
          runEventRowToJobEvent({
            id: Number(row.id),
            run_id: String(row.run_id),
            place_id: row.place_id != null ? String(row.place_id) : null,
            stage: String(row.stage),
            ran: Boolean(row.ran),
            reason: row.reason != null ? String(row.reason) : null,
            credits_est: row.credits_est != null ? Number(row.credits_est) : null,
            duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
            meta_json: row.meta_json,
            created_at: String(row.created_at),
          }),
        );
      }

      const incomingCosts: RunStreamCost[] = (costBody.events ?? []).map((row) => ({
        id: Number(row.id),
        usd: Number(row.usd ?? 0),
        provider: String(row.provider),
        operation: String(row.operation),
        model: row.model != null ? String(row.model) : null,
        units: Number(row.units ?? 0),
        unit_type: String(row.unit_type ?? row.unitType ?? "units"),
        place_id: row.place_id != null ? String(row.place_id) : null,
        meta_json: row.meta_json,
        created_at: String(row.created_at),
      }));

      setEvents((prev) => mergeEvents(prev, incomingEvents, seenEventKeys.current));
      setCosts((prev) => mergeCosts(prev, incomingCosts, seenCostIds.current));
      setConnected(true);
    },
    [runId],
  );

  useEffect(() => {
    if (!runId || !enabled) return;

    let cancelled = false;
    seenEventKeys.current.clear();
    seenCostIds.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setWindowStartMs(Date.now());
    setLoading(true);
    setEvents([]);
    setCosts([]);
    setConnected(false);

    void fetchStream()
      .catch(() => {
        if (!cancelled) setConnected(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, enabled, fetchStream]);

  useEffect(() => {
    if (!runId || !enabled || !pollWhileRunning || runStatus !== "running") return;
    const id = window.setInterval(() => {
      void fetchStream();
    }, 3000);
    return () => window.clearInterval(id);
  }, [runId, enabled, pollWhileRunning, runStatus, fetchStream]);

  useEffect(() => {
    if (!runId || !enabled) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [runId, enabled]);

  const totalUsd = useMemo(() => costs.reduce((sum, row) => sum + row.usd, 0), [costs]);

  const usdPerMinute = useMemo(() => {
    if (costs.length === 0 || windowStartMs == null) return 0;
    void tick;
    // eslint-disable-next-line react-hooks/purity -- rolling window needs wall clock
    const elapsedMin = Math.max((Date.now() - windowStartMs) / 60_000, 1 / 60);
    return totalUsd / elapsedMin;
  }, [costs.length, totalUsd, windowStartMs, tick]);

  return { events, costs, totalUsd, usdPerMinute, connected, loading };
}
