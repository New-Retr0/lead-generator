"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ActiveJobDock } from "@/components/active-job-dock";
import { CampaignMatrixBoard } from "@/components/campaign-matrix-board";
import { useJobStream } from "@/hooks/use-job-stream";
import {
  buildCampaignCells,
  formatCellLabel,
  type CampaignCell,
} from "@/lib/job-activity";

function useCellToasts(cells: CampaignCell[]) {
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    // Prime on first snapshot so historical SSE/poll replay does not spam.
    if (!primedRef.current) {
      for (const cell of cells) {
        if (cell.status !== "queued") {
          seenRef.current.add(`${cell.key}:${cell.status}`);
        }
      }
      primedRef.current = true;
      return;
    }

    for (const cell of cells) {
      if (cell.status !== "running" && cell.status !== "done" && cell.status !== "failed") {
        continue;
      }
      const token = `${cell.key}:${cell.status}`;
      if (seenRef.current.has(token)) continue;
      seenRef.current.add(token);

      const label = formatCellLabel(cell.market, cell.category);
      if (cell.status === "running") {
        toast.message(`${label} started`, {
          description: "Campaign cell is researching",
          action: cell.runId
            ? {
                label: "Studio",
                onClick: () => {
                  window.location.href = `/runs/${encodeURIComponent(cell.runId!)}`;
                },
              }
            : undefined,
        });
      } else if (cell.status === "done") {
        const parts = [
          cell.completed != null ? `${cell.completed} completed` : null,
          cell.discovered != null ? `${cell.discovered} discovered` : null,
        ].filter(Boolean);
        toast.success(`${label} completed`, {
          description: parts.join(" · ") || undefined,
          action: cell.runId
            ? {
                label: "Studio",
                onClick: () => {
                  window.location.href = `/runs/${encodeURIComponent(cell.runId!)}`;
                },
              }
            : undefined,
        });
      } else {
        toast.error(`${label} failed`);
      }
    }
  }, [cells]);
}

export function CampaignLivePanel({
  jobId,
  campaign,
  markets,
  categories,
  onDone,
}: {
  jobId: string;
  campaign: string;
  markets: string[];
  categories: string[];
  onDone?: (status: string) => void;
}) {
  const stream = useJobStream({ jobId, onDone });
  const eventAxes = useMemo(() => {
    // Only cell-level events carry campaign category_key. lead_* emit human labels.
    const axisEvents = new Set([
      "run_started",
      "run_done",
      "run_failed",
      "discovery_done",
      "firecrawl_plan",
      "heartbeat",
    ]);
    const marketSet = new Set<string>();
    const categorySet = new Set<string>();
    for (const event of stream.events) {
      if (!axisEvents.has(event.event)) continue;
      if (typeof event.market === "string" && event.market) {
        marketSet.add(event.market);
      }
      if (typeof event.category === "string" && event.category) {
        categorySet.add(event.category);
      }
    }
    return {
      markets: [...marketSet],
      categories: [...categorySet],
    };
  }, [stream.events]);

  // Union planned axes with anything seen in the stream so truncated/wrong
  // Launch props still light real cells (external jobs, partial selection).
  const effectiveMarkets = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of [...markets, ...eventAxes.markets]) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }, [markets, eventAxes.markets]);

  const effectiveCategories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of [...categories, ...eventAxes.categories]) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }, [categories, eventAxes.categories]);

  const cells = useMemo(
    () =>
      buildCampaignCells({
        markets: effectiveMarkets,
        categories: effectiveCategories,
        events: stream.events,
        jobStatus: stream.status,
      }),
    [effectiveMarkets, effectiveCategories, stream.events, stream.status],
  );

  useCellToasts(cells);

  return (
    <div className="space-y-4" data-testid="campaign-live-panel">
      <ActiveJobDock jobId={jobId} campaign={campaign} stream={stream} />
      <CampaignMatrixBoard
        cells={cells}
        markets={effectiveMarkets}
        categories={effectiveCategories}
      />
      {stream.phase === "live" || stream.phase === "polling" ? (
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tip · click a finished or live cell to open{" "}
          <Link href="/runs" className="text-primary underline-offset-2 hover:underline">
            Pipeline Studio
          </Link>
        </p>
      ) : null}
    </div>
  );
}
