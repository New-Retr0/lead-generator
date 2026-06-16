"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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

export type StatCardDetail = { label: string; value: string };

export function StatCard({
  label,
  value,
  format,
  sub,
  details,
  expandable = false,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  sub?: string;
  details?: StatCardDetail[];
  expandable?: boolean;
  icon: LucideIcon;
  tone?: keyof typeof TONE_STYLES;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const styles = TONE_STYLES[tone];
  const showExpand = expandable && (details?.length ?? 0) > 0;

  return (
    <Card className="hover-lift group relative flex h-full flex-col overflow-hidden py-5">
      <div
        className={cn(
          "absolute -right-10 -top-10 size-32 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100 opacity-60",
          styles.glow,
        )}
        aria-hidden
      />
      <CardContent className="relative flex flex-1 flex-col justify-between gap-3 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-[2rem] font-bold leading-none tabular-nums tracking-tight">
              <AnimatedNumber value={value} format={format} />
            </p>
            {sub ? (
              <p className="mt-2 truncate text-xs leading-relaxed text-muted-foreground">
                {sub}
              </p>
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
        </div>

        {showExpand ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {open ? "Less" : "More"}
              <ChevronDown
                className={cn("size-3 transition-transform", open && "rotate-180")}
              />
            </button>
            {reduced ? (
              open ? (
                <dl className="mt-1 space-y-0">
                  {details!.map((d) => (
                    <div
                      key={d.label}
                      className="flex justify-between gap-2 border-t border-border/40 py-1.5 text-xs"
                    >
                      <dt className="text-muted-foreground">{d.label}</dt>
                      <dd className="font-medium tabular-nums">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null
            ) : (
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.dl
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    {details!.map((d) => (
                      <div
                        key={d.label}
                        className="flex justify-between gap-2 border-t border-border/40 py-1.5 text-xs"
                      >
                        <dt className="text-muted-foreground">{d.label}</dt>
                        <dd className="font-medium tabular-nums">{d.value}</dd>
                      </div>
                    ))}
                  </motion.dl>
                ) : null}
              </AnimatePresence>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
