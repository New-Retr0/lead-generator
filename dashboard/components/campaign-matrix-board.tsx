"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { LiveDot } from "@/components/animated";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  campaignCellStats,
  formatCellLabel,
  type CampaignCell,
  type CampaignCellStatus,
} from "@/lib/job-activity";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<CampaignCellStatus, string> = {
  queued: "bg-muted-foreground/25 ring-1 ring-border/60",
  running: "bg-primary shadow-[0_0_8px_color-mix(in_oklab,var(--primary)_55%,transparent)] animate-pulse",
  done: "bg-success",
  failed: "bg-destructive",
};

function shortCategory(category: string): string {
  const parts = category.replace(/_/g, " ").split(" ");
  if (parts.length === 1) return parts[0]!.slice(0, 3);
  return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
}

export function CampaignMatrixBoard({
  cells,
  markets,
  categories,
}: {
  cells: CampaignCell[];
  markets: string[];
  categories: string[];
}) {
  const stats = useMemo(() => campaignCellStats(cells), [cells]);
  const byKey = useMemo(() => new Map(cells.map((c) => [c.key, c])), [cells]);
  const progress =
    stats.total > 0 ? ((stats.done + stats.failed) / stats.total) * 100 : 0;
  const currentMarket = stats.current?.market ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Put live/done markets first so "Now · San Diego · Industrial" is not buried
  // under pages of untouched Reedley/Dinuba rows.
  const orderedMarkets = useMemo(() => {
    const rank = (market: string): number => {
      let best = 3;
      for (const category of categories) {
        const cell = byKey.get(`${market}::${category}`);
        if (!cell) continue;
        if (cell.status === "running") best = Math.min(best, 0);
        else if (cell.status === "done" || cell.status === "failed") {
          best = Math.min(best, 1);
        } else {
          best = Math.min(best, 2);
        }
      }
      return best;
    };
    return [...markets].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a === currentMarket) return -1;
      if (b === currentMarket) return 1;
      return markets.indexOf(a) - markets.indexOf(b);
    });
  }, [markets, categories, byKey, currentMarket]);

  useEffect(() => {
    if (!currentMarket || !scrollRef.current) return;
    const row = scrollRef.current.querySelector<HTMLElement>(
      `[data-matrix-market="${currentMarket}"]`,
    );
    row?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [currentMarket]);

  if (markets.length === 0 || categories.length === 0) {
    return null;
  }

  return (
    <div
      className="panel space-y-3 rounded-2xl border border-border/50 p-4"
      data-testid="campaign-matrix-board"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Campaign matrix
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {stats.done + stats.failed} / {stats.total} cells
            {stats.running > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-normal text-primary">
                <LiveDot tone="primary" />
                {stats.running} live
              </span>
            ) : null}
          </p>
          {stats.current ? (
            <p className="truncate text-xs capitalize text-muted-foreground">
              Now · {formatCellLabel(stats.current.market, stats.current.category)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {stats.done + stats.failed >= stats.total && stats.total > 0
                ? "Matrix complete"
                : "Waiting for first cell…"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          <Legend swatch={STATUS_DOT.queued} label="Queued" />
          <Legend swatch={STATUS_DOT.running} label="Running" />
          <Legend swatch={STATUS_DOT.done} label="Done" />
          <Legend swatch={STATUS_DOT.failed} label="Failed" />
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/80 transition-[width] duration-500"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>

      <div ref={scrollRef} className="max-h-72 overflow-auto">
        <div
          className="inline-grid min-w-full gap-x-1 gap-y-1.5"
          style={{
            gridTemplateColumns: `minmax(7.5rem, max-content) repeat(${categories.length}, minmax(1.1rem, 1.35rem))`,
          }}
        >
          <div className="sticky top-0 z-[2] bg-card/95" />
          {categories.map((category) => (
            <Tooltip key={`h-${category}`}>
              <TooltipTrigger asChild>
                <div className="sticky top-0 z-[2] truncate bg-card/95 text-center font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                  {shortCategory(category)}
                </div>
              </TooltipTrigger>
              <TooltipContent className="capitalize">
                {category.replace(/_/g, " ")}
              </TooltipContent>
            </Tooltip>
          ))}

          {orderedMarkets.map((market) => (
            <MarketRow
              key={market}
              market={market}
              categories={categories}
              byKey={byKey}
              active={market === currentMarket}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MarketRow({
  market,
  categories,
  byKey,
  active,
}: {
  market: string;
  categories: string[];
  byKey: Map<string, CampaignCell>;
  active: boolean;
}) {
  return (
    <>
      <div
        data-matrix-market={market}
        className={cn(
          "sticky left-0 z-[1] truncate pr-2 font-mono text-[10px] capitalize backdrop-blur-sm",
          active
            ? "bg-primary/10 font-semibold text-foreground"
            : "bg-card/95 text-muted-foreground",
        )}
      >
        {market.replace(/_/g, " ")}
      </div>
      {categories.map((category) => {
        const cell = byKey.get(`${market}::${category}`);
        if (!cell) {
          return <div key={`${market}-${category}`} className="size-4" />;
        }
        return <CellDot key={cell.key} cell={cell} />;
      })}
    </>
  );
}

function CellDot({ cell }: { cell: CampaignCell }) {
  const label = formatCellLabel(cell.market, cell.category);
  const detail = [
    cell.status,
    cell.discovered != null ? `${cell.discovered} discovered` : null,
    cell.completed != null ? `${cell.completed} completed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dot = (
    <span
      className={cn(
        "mx-auto block size-3.5 rounded-sm transition-transform",
        STATUS_DOT[cell.status],
        cell.runId && "hover:scale-110",
      )}
      aria-label={`${label}: ${detail}`}
    />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {cell.runId ? (
          <Link
            href={`/runs/${encodeURIComponent(cell.runId)}`}
            className="flex items-center justify-center py-0.5"
          >
            {dot}
          </Link>
        ) : (
          <span className="flex cursor-default items-center justify-center py-0.5">
            {dot}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs capitalize">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{detail}</p>
        {cell.runId ? (
          <p className="mt-1 font-mono text-[10px] normal-case text-muted-foreground">
            Open Studio
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">Not started</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", swatch)} />
      {label}
    </span>
  );
}
