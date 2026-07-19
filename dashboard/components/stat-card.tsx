"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/animated";
import { useHydrated, useSafeReducedMotion } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const TONE_ICON_STYLES = {
  default: "border-primary/20 bg-primary/10 text-primary",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
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
  onClick,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  sub?: string;
  details?: StatCardDetail[];
  expandable?: boolean;
  icon: LucideIcon;
  tone?: keyof typeof TONE_ICON_STYLES;
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const reduced = useSafeReducedMotion();
  // Static expand path until hydrated so SSR/client markup matches.
  const useMotionExpand = hydrated && !reduced;
  const iconStyles = TONE_ICON_STYLES[tone];
  const showExpand = expandable && (details?.length ?? 0) > 0;
  const clickable = Boolean(onClick);

  return (
    <Card
      className={cn(
        "group relative flex h-full flex-col overflow-hidden py-5",
        clickable && "hover-lift cursor-pointer",
      )}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
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
              "flex size-10 shrink-0 items-center justify-center rounded-sm border",
              iconStyles,
            )}
          >
            <Icon className="size-4" strokeWidth={1.5} />
          </div>
        </div>

        {showExpand ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
              className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {open ? "Less" : "More"}
              <ChevronDown
                className={cn("size-3 transition-transform", open && "rotate-180")}
              />
            </button>
            {!useMotionExpand ? (
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
