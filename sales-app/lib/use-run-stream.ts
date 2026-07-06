"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

function eventKey(row: { id?: number; ts: string; event: string; place_id?: string }) {
  return `${row.id ?? ""}:${row.ts}:${row.event}:${row.place_id ?? ""}`;
}

export function useRunStream(runId: string | null, enabled = true): RunStreamState {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [costs, setCosts] = useState<RunStreamCost[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(Boolean(runId && enabled));
  const seenEventKeys = useRef(new Set<string>());
  const seenCostIds = useRef(new Set<number>());
  const [windowStartMs, setWindowStartMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!runId || !enabled) {
      return;
    }

    let cancelled = false;
    seenEventKeys.current.clear();
    seenCostIds.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runId change reset
    setWindowStartMs(Date.now());
    setLoading(true);
    setEvents([]);
    setCosts([]);
    setConnected(false);

    const supabase = createClient();

    const appendEvent = (evt: JobEvent, id?: number) => {
      const key = eventKey({ id, ts: evt.ts, event: evt.event, place_id: evt.place_id });
      if (seenEventKeys.current.has(key)) return;
      seenEventKeys.current.add(key);
      setEvents((prev) => [...prev, evt]);
    };

    const appendCost = (row: RunStreamCost) => {
      if (seenCostIds.current.has(row.id)) return;
      seenCostIds.current.add(row.id);
      setCosts((prev) => [...prev, row]);
    };

    void Promise.all([
      fetch(`/api/runs/${encodeURIComponent(runId)}/events`).then((r) => r.json()),
      fetch(`/api/runs/${encodeURIComponent(runId)}/costs`).then((r) => r.json()),
    ])
      .then(([eventBody, costBody]) => {
        if (cancelled) return;
        for (const row of eventBody.events ?? []) {
          appendEvent(runEventRowToJobEvent(row), row.id);
        }
        for (const row of costBody.events ?? []) {
          appendCost({
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
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const channel = supabase
      .channel(`run-stream:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "run_events",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          appendEvent(
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
            Number(row.id),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cost_events",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          appendCost({
            id: Number(row.id),
            usd: Number(row.usd ?? 0),
            provider: String(row.provider),
            operation: String(row.operation),
            model: row.model != null ? String(row.model) : null,
            units: Number(row.units ?? 0),
            unit_type: String(row.unit_type ?? "units"),
            place_id: row.place_id != null ? String(row.place_id) : null,
            meta_json: row.meta_json,
            created_at: String(row.created_at),
          });
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [runId, enabled]);

  useEffect(() => {
    if (!runId || !enabled) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [runId, enabled]);

  const totalUsd = useMemo(
    () => costs.reduce((sum, row) => sum + row.usd, 0),
    [costs],
  );

  const usdPerMinute = useMemo(() => {
    if (costs.length === 0 || windowStartMs == null) return 0;
    void tick;
    // eslint-disable-next-line react-hooks/purity -- rolling window needs wall clock
    const elapsedMin = Math.max((Date.now() - windowStartMs) / 60_000, 1 / 60);
    return totalUsd / elapsedMin;
  }, [costs.length, totalUsd, windowStartMs, tick]);

  return { events, costs, totalUsd, usdPerMinute, connected, loading };
}
