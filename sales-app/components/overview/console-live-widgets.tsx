"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Layers } from "lucide-react";
import { LiveDot, Odometer } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { FIRECRAWL_PLAN_CREDITS } from "@/lib/cost-budget";
import { formatUsd } from "@/lib/utils";
import type { QueueMetrics, WorkerHeartbeat } from "@/lib/types";

type QueueResponse = {
  metrics: QueueMetrics;
  workers: WorkerHeartbeat[];
};

function formatAge(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function QueueStatusWidget() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      void fetch("/api/queue")
        .then((r) => r.json())
        .then((body: QueueResponse & { error?: string }) => {
          if (cancelled) return;
          if (body.error) {
            setError(body.error);
            return;
          }
          setData(body);
          setError("");
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load queue");
          }
        });
    };

    load();
    const interval = window.setInterval(load, 15_000);

    const supabase = createClient();
    const channel = supabase
      .channel("overview-worker-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_status" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_jobs" },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, []);

  const metrics = data?.metrics;
  const workers = data?.workers ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="size-4 text-muted-foreground" />
          Pipeline queue
        </CardTitle>
        <CardDescription>pgmq depth and worker heartbeats</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !metrics ? (
          <p className="text-sm text-muted-foreground">Loading queue metrics…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Queue depth
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{metrics.queue_depth}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics.queued_jobs} queued job(s)
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Oldest message
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatAge(metrics.oldest_msg_age_sec)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {metrics.running_jobs} running
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Workers</p>
              {workers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No worker heartbeats yet — start `pallares-leads worker`.
                </p>
              ) : (
                workers.map((worker) => (
                  <div
                    key={worker.worker_id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{worker.worker_id}</p>
                      <p className="truncate text-muted-foreground">
                        {worker.hostname ?? "unknown host"} · seen{" "}
                        {new Date(worker.last_seen).toLocaleTimeString()}
                      </p>
                    </div>
                    <Badge variant={worker.status === "busy" ? "default" : "secondary"}>
                      {worker.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CreditBurnWidget() {
  const [totalUsd, setTotalUsd] = useState(0);
  const [windowStart] = useState(() => performance.now());
  const [recentCount, setRecentCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [percentOfPlan, setPercentOfPlan] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const since = new Date();
    since.setMinutes(since.getMinutes() - 5);

    void supabase
      .from("credit_snapshots")
      .select("remaining_credits, used_credits, snapshot_json")
      .eq("provider", "firecrawl")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: snap }) => {
        if (!snap) return;
        let plan = FIRECRAWL_PLAN_CREDITS;
        let used = snap.used_credits != null ? Number(snap.used_credits) : null;
        const payload = snap.snapshot_json as Record<string, unknown> | null;
        if (payload) {
          const inner =
            payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
              ? (payload.data as Record<string, unknown>)
              : payload;
          const planRaw = inner.planCredits ?? inner.plan_credits;
          if (planRaw != null) plan = Number(planRaw);
          if (used == null && inner.usedCredits != null) used = Number(inner.usedCredits);
          if (used == null && snap.remaining_credits != null && plan > 0) {
            used = plan - Number(snap.remaining_credits);
          }
        }
        if (used != null && plan > 0) {
          setPercentOfPlan((used / plan) * 100);
        }
      });

    void supabase
      .from("cost_events")
      .select("usd")
      .gte("created_at", since.toISOString())
      .then(({ data }) => {
        const rows = data ?? [];
        setRecentCount(rows.length);
        setTotalUsd(rows.reduce((sum, row) => sum + Number(row.usd ?? 0), 0));
      });

    const channel = supabase
      .channel("overview-cost-burn")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cost_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const usd = Number(row.usd ?? 0);
          setTotalUsd((prev) => prev + usd);
          setRecentCount((prev) => prev + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const usdPerMinute = useMemo(() => {
    void tick;
    // eslint-disable-next-line react-hooks/purity -- rolling window needs wall clock
    const elapsedMin = Math.max((performance.now() - windowStart) / 60_000, 1 / 60);
    return totalUsd / elapsedMin;
  }, [totalUsd, windowStart, tick]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4 text-muted-foreground" />
          Live credit burn
          <LiveDot tone="warning" />
        </CardTitle>
        <CardDescription>
          Rolling spend from new cost_events (Realtime)
          {percentOfPlan != null ? (
            <span className="block pt-1">
              {percentOfPlan.toFixed(1)}% of monthly Firecrawl plan used
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              USD / minute
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tabular-nums leading-none">
              <Odometer value={usdPerMinute} format={formatUsd} climbSeconds={1.2} />
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p className="flex items-center justify-end gap-1">
              <Cpu className="size-3" />
              {recentCount} event(s) in window
            </p>
            <p className="mt-1">Session total {formatUsd(totalUsd)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
