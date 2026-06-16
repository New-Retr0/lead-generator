"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/animated";
import { cn } from "@/lib/utils";

const TONE_STYLES = {
  default: {
    tile: "from-primary/90 to-[oklch(0.55_0.16_290)] shadow-[0_6px_20px_-6px_oklch(0.5_0.19_262/0.55)]",
    glow: "bg-primary/12",
  },
  success: {
    tile: "from-success/90 to-[oklch(0.62_0.13_183)] shadow-[0_6px_20px_-6px_oklch(0.55_0.14_152/0.55)]",
    glow: "bg-success/12",
  },
  warning: {
    tile: "from-warning/90 to-[oklch(0.66_0.16_45)] shadow-[0_6px_20px_-6px_oklch(0.6_0.14_70/0.55)]",
    glow: "bg-warning/12",
  },
} as const;

export function StatCard({
  label,
  value,
  format,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  sub?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE_STYLES;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <Card className="hover-lift group relative overflow-hidden py-5">
      <div
        className={cn(
          "absolute -right-10 -top-10 size-32 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100 opacity-60",
          styles.glow,
        )}
        aria-hidden
      />
      <CardContent className="relative flex items-start justify-between gap-3 px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-[2rem] font-bold leading-none tabular-nums tracking-tight">
            <AnimatedNumber value={value} format={format} />
          </p>
          {sub ? (
            <p className="mt-2 truncate text-xs text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white",
            "transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3",
            styles.tile,
          )}
        >
          <Icon className="size-4.5" strokeWidth={2.25} />
        </div>
      </CardContent>
    </Card>
  );
}
