"use client";

import { motion } from "motion/react";
import { AnimatedNumber } from "@/components/animated";
import { providerLabel } from "@/components/campaigns/estimate-breakdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { formatCredits, formatUsd } from "@/lib/utils";

export type StatDetailRow = { label: string; value: string };

export type ProviderSpendRow = {
  provider: string;
  usd7d: number;
  usdMonth: number;
};

export function StatDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  format,
  rows,
  providerRows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  value: number;
  format?: (n: number) => string;
  rows?: StatDetailRow[];
  providerRows?: ProviderSpendRow[];
}) {
  const reduced = useSafeReducedMotion();
  const max7d = providerRows?.reduce((m, r) => Math.max(m, r.usd7d), 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <p className="text-4xl font-bold tabular-nums tracking-tight">
          <AnimatedNumber value={value} format={format} />
        </p>
        {rows && rows.length > 0 ? (
          <dl className="mt-4 space-y-2">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between gap-3 border-t border-border/40 pt-2 text-sm"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-medium tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {providerRows && providerRows.length > 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Provider breakdown
            </p>
            {providerRows.map((row) => (
              <div key={row.provider} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{providerLabel(row.provider)}</span>
                  <span className="font-mono tabular-nums">
                    7d {formatUsd(row.usd7d)} · MTD {formatUsd(row.usdMonth)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={reduced ? false : { width: 0 }}
                    animate={{
                      width: max7d > 0 ? `${Math.round((row.usd7d / max7d) * 100)}%` : "0%",
                    }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 120, damping: 20 }
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function formatCreditBalance(remaining: number | null, used: number | null, plan: number | null) {
  const parts: string[] = [];
  if (remaining != null) parts.push(`${formatCredits(remaining)} remaining`);
  if (used != null && plan != null) {
    parts.push(`${formatCredits(used)} of ${formatCredits(plan)} used`);
  } else if (used != null) {
    parts.push(`${formatCredits(used)} used`);
  }
  return parts.join(" · ") || "—";
}
