"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clapperboard, ListVideo, Terminal } from "lucide-react";
import { LiveDot, TypingDots } from "@/components/animated";
import { CancelJobButton } from "@/components/cancel-job-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { JobStream } from "@/hooks/use-job-stream";
import { latestRunId, nowLine, recentLogTail } from "@/lib/job-activity";
import { cn } from "@/lib/utils";

function phaseLabel(
  running: boolean,
  phase: string,
  status: string,
  stale: boolean,
  detached: boolean,
): string {
  if (!running) return status;
  if (detached) return "detached";
  if (phase === "reconnecting" || phase === "polling") return "reconnecting";
  if (phase === "connecting") return "starting";
  if (stale) return "stale";
  return "live";
}

export function ActiveJobDock({
  jobId,
  campaign,
  stream,
}: {
  jobId: string;
  campaign?: string;
  stream: JobStream;
}) {
  const { status, phase, lines, events } = stream;
  const [now, setNow] = useState(() => Date.now());
  const [detached, setDetached] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncDetached = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { job?: { detached?: boolean } };
        if (!cancelled) setDetached(Boolean(body.job?.detached));
      } catch {
        // ignore
      }
    };
    void syncDetached();
    const id = window.setInterval(() => void syncDetached(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  const running = status === "running" || status === "pending";
  // Heartbeats keep the stream "alive" — ignore them for stall detection.
  let lastMeaningfulTs = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (!evt || evt.event === "heartbeat") continue;
    const ts = Date.parse(evt.ts ?? "");
    if (!Number.isNaN(ts)) {
      lastMeaningfulTs = ts;
      break;
    }
  }
  let heartbeatStall: {
    pending: number;
    done: number | null;
    total: number | null;
    stalled: string[];
  } | null = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (evt?.event !== "heartbeat") continue;
    heartbeatStall = {
      pending: typeof evt.pending === "number" ? evt.pending : 0,
      done: typeof evt.done === "number" ? evt.done : null,
      total: typeof evt.total === "number" ? evt.total : null,
      stalled: Array.isArray(evt.stalled)
        ? evt.stalled.filter((v): v is string => typeof v === "string")
        : [],
    };
    break;
  }
  const stale =
    running &&
    ((lastMeaningfulTs > 0 && now - lastMeaningfulTs > 3 * 60 * 1000) ||
      Boolean(heartbeatStall && heartbeatStall.pending > 0 && heartbeatStall.stalled.length > 0));

  let activity = nowLine({
    events,
    lines,
    fallback: campaign
      ? `Spawning pallares-leads run-campaign (${campaign.replace(/_/g, " ")})…`
      : "Spawning pallares-leads…",
  });
  if (
    stale &&
    heartbeatStall &&
    heartbeatStall.pending > 0 &&
    (heartbeatStall.done != null || heartbeatStall.stalled.length > 0)
  ) {
    const progress =
      heartbeatStall.done != null && heartbeatStall.total != null
        ? `${heartbeatStall.done}/${heartbeatStall.total}`
        : null;
    const names = heartbeatStall.stalled.slice(0, 2).join(", ");
    if (names) {
      activity = `Stalled ${progress ? `${progress} · ` : ""}waiting on ${names}`;
    } else if (progress) {
      activity = `Stalled at ${progress} — waiting on owner-chain/agent`;
    }
  }
  const logTail = useMemo(() => recentLogTail(lines, 20), [lines]);
  const runId = useMemo(() => latestRunId(events), [events]);
  const planLine = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const evt = events[i];
      if (evt?.event !== "firecrawl_plan") continue;
      const name =
        typeof evt.plan_name === "string"
          ? evt.plan_name
          : typeof evt.plan_key === "string"
            ? evt.plan_key
            : "Firecrawl";
      const workers =
        typeof evt.place_workers === "number" ? evt.place_workers : null;
      const concurrency =
        typeof evt.max_concurrency === "number" ? evt.max_concurrency : null;
      if (workers != null && concurrency != null) {
        return `${name} · ${workers}w / ${concurrency} browsers`;
      }
      return String(name);
    }
    return null;
  }, [events]);

  const studioHref = runId ? `/runs/${encodeURIComponent(runId)}` : null;
  const runsJobHref = `/runs?job=${encodeURIComponent(jobId)}`;
  const label = phaseLabel(running, phase, status, stale, detached);
  const campaignLabel = campaign?.replace(/_/g, " ") ?? "job";
  const showLiveChrome = running && !stale && !detached && phase === "live";

  return (
    <div
      className={cn("rounded-2xl", showLiveChrome && "live-ring p-px")}
      data-testid="active-job-dock"
    >
      <div className="panel-strong overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.12em]">
                <Terminal className="size-3" />
                Local CLI
              </Badge>
              <p className="truncate text-sm font-semibold capitalize">{campaignLabel}</p>
              {showLiveChrome ? <LiveDot tone="primary" /> : null}
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.12em]",
                  stale || detached ? "text-warning" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            <p className="flex min-h-[1.25rem] items-center gap-2 text-xs text-muted-foreground">
              {running && events.length === 0 && logTail.length === 0 ? (
                <TypingDots />
              ) : null}
              <span
                className={cn(
                  "truncate font-mono text-[11px]",
                  stale ? "text-warning" : "text-foreground/80",
                )}
              >
                {activity}
              </span>
            </p>
            {planLine ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Firecrawl · {planLine}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CancelJobButton jobId={jobId} visible={running} />
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
              <Link href={runsJobHref}>
                <ListVideo className="size-3.5" />
                Runs
              </Link>
            </Button>
            {studioHref ? (
              <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" asChild>
                <Link href={studioHref}>
                  <Clapperboard className="size-3.5" />
                  Open Studio
                </Link>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2.5 text-xs"
                      disabled
                    >
                      <Clapperboard className="size-3.5" />
                      Open Studio
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Studio opens once a persisted run_id appears in the job stream.
                </TooltipContent>
              </Tooltip>
            )}
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
              <Link href="/runs">
                <ListVideo className="size-3.5" />
                View runs
              </Link>
            </Button>
          </div>
        </div>

        {logTail.length > 0 ? (
          <div className="ops-terminal mx-4 my-3 rounded-lg">
            <div className="ops-terminal-scanlines" />
            <div className="ops-terminal-title">
              <span className="ops-terminal-dot" />
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ops-success)]">
                Online
              </span>
              <span className="flex-1 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ops-title-text)]">
                Local CLI
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ops-dim)]">
                Tail
              </span>
            </div>
            <pre className="ops-terminal-body">
              {logTail.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`} className="truncate">
                  {line}
                </div>
              ))}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
