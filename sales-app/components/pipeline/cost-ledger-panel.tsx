"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Odometer } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  GRANULARITY_LABELS,
  rollupCosts,
  type CostGroup,
  type Granularity,
} from "@/lib/pipeline/rollup";
import type { PipelineCostEvent } from "@/lib/pipeline/stages";
import { formatUsd, formatUsdCompact } from "@/lib/utils";

export function CostLedgerPanel({
  events,
  granularity,
  onGranularityChange,
}: {
  events: PipelineCostEvent[];
  granularity: Granularity;
  onGranularityChange: (level: Granularity) => void;
}) {
  const groups = useMemo(
    () => rollupCosts(events, granularity),
    [events, granularity],
  );

  const totalUsd = useMemo(
    () => events.reduce((s, e) => s + e.usd, 0),
    [events],
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cost ledger</CardTitle>
        <CardDescription>
          Drag granularity — canvas badges mirror stage rollup at level 2+.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{GRANULARITY_LABELS[granularity]}</span>
            <span className="text-muted-foreground">{granularity}/4</span>
          </div>
          <Slider
            value={[granularity]}
            min={0}
            max={4}
            step={1}
            onValueChange={([v]) => onGranularityChange(v as Granularity)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            {(Object.entries(GRANULARITY_LABELS) as [string, string][]).map(([k, label]) => (
              <span key={k}>{label}</span>
            ))}
          </div>
        </div>

        <div className="flex items-baseline justify-between border-b pb-2">
          <span className="text-xs text-muted-foreground">Total</span>
          <Odometer
            value={totalUsd}
            format={(n) => formatUsd(n)}
            className="text-lg font-bold"
          />
        </div>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <LedgerRow key={group.key} group={group} level={granularity} />
            ))}
          </AnimatePresence>
          {groups.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted-foreground">
              No cost events yet.
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}

function LedgerRow({ group, level }: { group: CostGroup; level: Granularity }) {
  const event = group.event;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="flex items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border/60 hover:bg-muted/40"
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{group.label}</p>
        {level === 4 && event ? (
          <p className="truncate text-[10px] text-muted-foreground">
            {new Date(event.created_at).toLocaleTimeString()} · {event.model ?? "—"} ·{" "}
            {event.units} {event.unit_type}
            {event.place_id ? ` · ${event.place_id.slice(0, 12)}…` : ""}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            {group.eventCount} call{group.eventCount === 1 ? "" : "s"}
            {group.avgDurationMs != null
              ? ` · avg ${Math.round(group.avgDurationMs)}ms`
              : ""}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-xs font-semibold tabular-nums">
          {formatUsdCompact(group.usd)}
        </p>
        {group.units > 0 && level < 4 ? (
          <Badge variant="secondary" className="mt-0.5 h-4 px-1 text-[9px]">
            {group.units.toLocaleString()} {group.unitType}
          </Badge>
        ) : null}
      </div>
    </motion.li>
  );
}
