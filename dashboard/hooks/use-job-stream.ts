"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { apiStreamUrl } from "@/lib/api-client";
import { fetchJson } from "@/lib/fetcher";
import type { JobEvent, JobRecord } from "@/lib/types";

export type JobStreamPhase =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "done";

export type LiveFromIndex = { lines: number; events: number };

export type JobStream = {
  status: string;
  phase: JobStreamPhase;
  lines: string[];
  events: JobEvent[];
  liveFromIndex: LiveFromIndex;
  retry: () => void;
};

const POLL_INTERVAL_MS = 3000;
const SSE_RETRY_MS = 30_000;
const RECONNECT_DELAY_MS = 3000;
const MAX_SSE_FAILURES = 3;

/**
 * Single SSE subscription for a job. Resume via Last-Event-ID / ?lastEventId=.
 */
export function useJobStream({
  jobId,
  onDone,
  onEvent,
}: {
  jobId: string | null;
  onDone?: (status: string) => void;
  onEvent?: (event: JobEvent) => void;
}): JobStream {
  const [lines, setLines] = useState<string[]>([]);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState("running");
  const [phase, setPhase] = useState<JobStreamPhase>("connecting");
  const [liveFromIndex, setLiveFromIndex] = useState<LiveFromIndex>({
    lines: 0,
    events: 0,
  });
  const [attempt, setAttempt] = useState(0);

  const fireDone = useEffectEvent((finished: string) => onDone?.(finished));
  const fireEvent = useEffectEvent((evt: JobEvent) => onEvent?.(evt));

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jobId change reset
    setLines([]);
    setEvents([]);
    setStatus("running");
    setPhase("connecting");
    setLiveFromIndex({ lines: 0, events: 0 });
    if (!jobId) return;

    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let sseRetryTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let failures = 0;
    let polling = false;
    let finished = false;
    let doneFired = false;
    let sawLive = false;
    let lastSeq: number | null = null;
    // Logs and structured events share the same seq space (event._seq is the
    // source log line). Track them separately so replaying logs does not drop
    // every subsequent event with the same seq.
    let appliedLogSeq = -1;
    let appliedEventSeq = -1;
    let baselineSet = false;
    let lineCount = 0;
    let eventCount = 0;

    const clearTimers = () => {
      if (pollTimer != null) window.clearInterval(pollTimer);
      if (sseRetryTimer != null) window.clearTimeout(sseRetryTimer);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      pollTimer = null;
      sseRetryTimer = null;
      reconnectTimer = null;
    };

    const finish = (finalStatus: string, wasLive: boolean) => {
      finished = true;
      clearTimers();
      source?.close();
      setStatus(finalStatus);
      setPhase("done");
      if (wasLive && !doneFired) {
        doneFired = true;
        fireDone(finalStatus);
      }
    };

    const markBaseline = () => {
      if (baselineSet) return;
      baselineSet = true;
      setLiveFromIndex({ lines: lineCount, events: eventCount });
    };

    const poll = async () => {
      try {
        const body = await fetchJson<{ job: JobRecord; nextSeq?: number }>(
          `/api/jobs/${jobId}`,
        );
        if (cancelled || finished) return;
        const job = body.job;
        if (typeof body.nextSeq === "number") lastSeq = body.nextSeq - 1;
        const prevEventCount = eventCount;
        lineCount = job.logs.length;
        eventCount = job.events.length;
        if (lastSeq != null) {
          appliedLogSeq = Math.max(appliedLogSeq, lastSeq);
          appliedEventSeq = Math.max(appliedEventSeq, lastSeq);
        }
        setLines(job.logs);
        setEvents(job.events);
        setStatus(job.status);
        for (const evt of job.events.slice(prevEventCount)) fireEvent(evt);
        markBaseline();
        if (job.status === "running" || job.status === "pending") {
          sawLive = true;
        } else {
          finish(job.status, sawLive);
        }
      } catch {
        // transient poll failure
      }
    };

    const scheduleSseRetry = () => {
      if (sseRetryTimer != null) window.clearTimeout(sseRetryTimer);
      sseRetryTimer = window.setTimeout(() => {
        sseRetryTimer = null;
        if (!cancelled && !finished && polling) connect();
      }, SSE_RETRY_MS);
    };

    const stopPolling = () => {
      polling = false;
      if (pollTimer != null) window.clearInterval(pollTimer);
      if (sseRetryTimer != null) window.clearTimeout(sseRetryTimer);
      pollTimer = null;
      sseRetryTimer = null;
    };

    const startPolling = () => {
      if (cancelled || finished || polling) return;
      polling = true;
      setPhase("polling");
      void poll();
      pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
      scheduleSseRetry();
    };

    const connect = () => {
      if (cancelled || finished) return;
      source?.close();
      const cursor = lastSeq != null ? `?lastEventId=${lastSeq}` : "";
      const es = new EventSource(apiStreamUrl(`/api/jobs/${jobId}/stream${cursor}`));
      source = es;

      es.addEventListener("log", (event) => {
        if (cancelled || finished) return;
        const data = JSON.parse(event.data) as { line: string; seq?: number };
        if (typeof data.seq === "number" && data.seq <= appliedLogSeq) return;
        if (typeof data.seq === "number") {
          lastSeq = Math.max(lastSeq ?? -1, data.seq);
          appliedLogSeq = Math.max(appliedLogSeq, data.seq);
        }
        lineCount += 1;
        setLines((prev) => [...prev, data.line]);
      });

      es.addEventListener("event", (event) => {
        if (cancelled || finished) return;
        const evt = JSON.parse(event.data) as JobEvent;
        if (typeof evt._seq === "number" && evt._seq <= appliedEventSeq) return;
        if (typeof evt._seq === "number") {
          lastSeq = Math.max(lastSeq ?? -1, evt._seq);
          appliedEventSeq = Math.max(appliedEventSeq, evt._seq);
        }
        eventCount += 1;
        setEvents((prev) => [...prev, evt]);
        fireEvent(evt);
      });

      es.addEventListener("ready", (event) => {
        if (cancelled || finished) return;
        const data = JSON.parse(event.data) as { status: string };
        failures = 0;
        if (polling) stopPolling();
        setStatus(data.status);
        if (data.status === "running" || data.status === "pending") sawLive = true;
        setPhase("live");
        markBaseline();
        // Large campaign replays can stall proxies; snap to persisted snapshot.
        void poll();
      });

      es.addEventListener("done", (event) => {
        if (cancelled || finished) return;
        const data = JSON.parse(event.data) as {
          status: string;
          exitCode: number | null;
          live: boolean;
        };
        finish(data.status, data.live || sawLive);
      });

      es.onerror = () => {
        if (cancelled || finished) return;
        if (polling) {
          es.close();
          scheduleSseRetry();
          return;
        }
        failures += 1;
        if (failures >= MAX_SSE_FAILURES) {
          es.close();
          startPolling();
          return;
        }
        setPhase("reconnecting");
        if (es.readyState === EventSource.CLOSED) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            if (!cancelled && !finished && !polling) connect();
          }, RECONNECT_DELAY_MS);
        }
      };
    };

    // Seed from persisted job JSON first so resume cursor skips the huge
    // campaign replay, then attach SSE for live updates only.
    void poll().then(() => {
      if (!cancelled && !finished) connect();
    });

    return () => {
      cancelled = true;
      clearTimers();
      source?.close();
    };
  }, [jobId, attempt]);

  return { status, phase, lines, events, liveFromIndex, retry };
}
