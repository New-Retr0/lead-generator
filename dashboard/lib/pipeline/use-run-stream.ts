"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVisibilityInterval } from "@/hooks/use-visibility-interval";
import { runEventRowToJobEvent } from "@/lib/run-events";
import type { JobEvent, RunEventRow, RunStudioCostRow } from "@/lib/types";

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

export type RunStreamInitial = {
  events?: RunEventRow[];
  costs?: RunStudioCostRow[];
};

function eventKey(evt: JobEvent): string {
  if (evt.id != null) return `id:${String(evt.id)}`;
  return [
    evt.ts,
    evt.event,
    evt.stage ?? "",
    evt.place_id ?? "",
    evt.reason ?? "",
    typeof evt.duration_ms === "number" ? String(evt.duration_ms) : "",
  ].join("|");
}

function mergeEvents(prev: JobEvent[], incoming: JobEvent[], seen: Set<string>): JobEvent[] {
  const next = [...prev];
  for (const evt of incoming) {
    const key = eventKey(evt);
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

function rowsToEvents(rows: RunEventRow[]): JobEvent[] {
  return rows.map((row) =>
    runEventRowToJobEvent({
      id: row.id,
      run_id: row.run_id,
      place_id: row.place_id,
      stage: row.stage,
      ran: row.ran,
      reason: row.reason,
      credits_est: row.credits_est,
      duration_ms: row.duration_ms,
      meta_json: row.meta_json,
      created_at: row.created_at,
    }),
  );
}

function rowsToCosts(rows: RunStudioCostRow[]): RunStreamCost[] {
  return rows.map((row) => ({
    id: row.id,
    usd: row.usd,
    provider: row.provider,
    operation: row.operation,
    model: row.model,
    units: row.units,
    unit_type: row.unit_type,
    place_id: row.place_id,
    meta_json: row.meta_json,
    created_at: row.created_at,
  }));
}

export function useRunStream(
  runId: string | null,
  options?: {
    enabled?: boolean;
    pollWhileRunning?: boolean;
    initial?: RunStreamInitial | null;
  },
): RunStreamState {
  const enabled = options?.enabled ?? true;
  const pollWhileRunning = options?.pollWhileRunning ?? true;
  const initial = options?.initial;

  const initialEvents = useMemo(
    () => (initial?.events?.length ? rowsToEvents(initial.events) : []),
    // Seed once per runId — parent remounts panel with key=runId on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed
    [runId],
  );
  const initialCosts = useMemo(
    () => (initial?.costs?.length ? rowsToCosts(initial.costs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed
    [runId],
  );

  const [events, setEvents] = useState<JobEvent[]>(initialEvents);
  const [costs, setCosts] = useState<RunStreamCost[]>(initialCosts);
  const [connected, setConnected] = useState(initialEvents.length > 0 || initialCosts.length > 0);
  const [loading, setLoading] = useState(
    Boolean(runId && enabled && initialEvents.length === 0 && initialCosts.length === 0),
  );
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [terminalCatchUp, setTerminalCatchUp] = useState(0);
  const seenEventKeys = useRef(new Set(initialEvents.map(eventKey)));
  const seenCostIds = useRef(new Set(initialCosts.map((c) => c.id)));
  const prevRunStatus = useRef<string | null>(null);
  const [windowStartMs, setWindowStartMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const fetchStream = useCallback(async () => {
    if (!runId) return;
    const [eventRes, costRes, runRes] = await Promise.all([
      fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { cache: "no-store" }),
      fetch(`/api/runs/${encodeURIComponent(runId)}/costs`, { cache: "no-store" }),
      fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" }),
    ]);
    if (!eventRes.ok || !costRes.ok) {
      throw new Error("studio_fetch_failed");
    }
    const eventBody = (await eventRes.json()) as { events?: Record<string, unknown>[] };
    const costBody = (await costRes.json()) as { events?: Record<string, unknown>[] };
    const runBody = (await runRes.json()) as { run?: { status?: string } };

    if (runRes.ok) {
      const nextStatus = runBody.run?.status;
      if (typeof nextStatus === "string") {
        const prev = prevRunStatus.current;
        prevRunStatus.current = nextStatus;
        setRunStatus(nextStatus);
        // finish_run can land before the final run_done / lead_done rows — keep
        // polling briefly after the terminal flip so Studio doesn't miss them.
        if (
          prev &&
          (prev === "running" || prev === "pending") &&
          nextStatus !== "running" &&
          nextStatus !== "pending"
        ) {
          setTerminalCatchUp(3);
        }
      }
    }

    const incomingEvents: JobEvent[] = [];
    for (const row of eventBody.events ?? []) {
      incomingEvents.push(
        runEventRowToJobEvent({
          id: Number(row.id),
          run_id: String(row.run_id ?? runId),
          place_id: row.place_id != null ? String(row.place_id) : null,
          stage: String(row.stage ?? ""),
          ran: Boolean(row.ran),
          reason: row.reason != null ? String(row.reason) : null,
          credits_est: row.credits_est != null ? Number(row.credits_est) : null,
          duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
          meta_json: row.meta_json,
          created_at: String(row.created_at ?? ""),
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
  }, [runId]);

  useEffect(() => {
    if (!runId || !enabled) return;

    let cancelled = false;
    seenEventKeys.current = new Set(initialEvents.map(eventKey));
    seenCostIds.current = new Set(initialCosts.map((c) => c.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setWindowStartMs(Date.now());
    // Clear prior run's terminal status so polling resumes immediately on navigate.
    setRunStatus(null);
    prevRunStatus.current = null;
    setTerminalCatchUp(0);
    setEvents(initialEvents);
    setCosts(initialCosts);
    setConnected(initialEvents.length > 0 || initialCosts.length > 0);
    setLoading(initialEvents.length === 0 && initialCosts.length === 0);

    void fetchStream()
      .catch(() => {
        if (!cancelled) {
          // Keep seeded telemetry if the poll fails.
          setConnected((prev) => prev || initialEvents.length > 0 || initialCosts.length > 0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, enabled, fetchStream, initialEvents, initialCosts]);

  // Poll while status is unknown (first paint) or still running — do not wait
  // for runStatus to flip from null or Studio freezes on seeded SSR data.
  // Also drain a short catch-up window after the run goes terminal.
  const shouldPollStream = Boolean(
    runId &&
      enabled &&
      pollWhileRunning &&
      (runStatus === null ||
        runStatus === "running" ||
        runStatus === "pending" ||
        terminalCatchUp > 0),
  );
  useVisibilityInterval(
    () => {
      void fetchStream().finally(() => {
        setTerminalCatchUp((n) => (n > 0 ? n - 1 : 0));
      });
    },
    3000,
    shouldPollStream,
  );

  useEffect(() => {
    if (!runId || !enabled || loading || events.length > 0 || costs.length > 0) return;
    let cancelled = false;
    const timers = [1500, 5000].map((delay) =>
      window.setTimeout(() => {
        if (!cancelled) void fetchStream();
      }, delay),
    );
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [runId, enabled, loading, events.length, costs.length, fetchStream]);

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
