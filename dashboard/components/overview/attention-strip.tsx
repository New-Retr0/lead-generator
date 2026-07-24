import Link from "next/link";
import { ArrowUpRight, PhoneCall, PlayCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttentionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "default" | "warning" | "danger" | "success" | "secondary";
  hint: string;
};

const TONE_VALUE: Record<AttentionItem["tone"], string> = {
  default: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  success: "text-success",
  secondary: "text-foreground",
};

function iconFor(key: string) {
  if (key === "running") return PlayCircle;
  if (key === "verified") return PhoneCall;
  return Radio;
}

/**
 * Ops pulse for the solo operator: what’s running, what’s verified,
 * and what’s still unverified (still tryable).
 */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  const running = items.find((item) => item.key === "running");
  const live = (running?.count ?? 0) > 0;

  return (
    <section
      data-testid="attention-strip"
      className="relative overflow-hidden rounded-2xl border border-border/70 bg-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/50 px-5 py-4 md:px-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Now
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">
            {live ? "Pipeline is live" : "Ready for the next pass"}
          </h2>
          <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
            Callable verified DMs first — partial inventory is the upgrade queue.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]",
            live ? "text-warning" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_25%,transparent)]" : "bg-muted-foreground/40",
            )}
          />
          {live ? `${running?.count} active` : "Idle"}
        </span>
      </div>

      <div className="grid divide-y divide-border/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map((item) => {
          const Icon = iconFor(item.key);
          return (
            <Link
              key={item.key}
              href={item.href}
              className="group relative flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-accent/50 md:px-6"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <Icon className="size-3.5" />
                  {item.label}
                </span>
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-colors group-hover:text-primary" />
              </div>
              <p
                className={cn(
                  "font-mono text-3xl font-semibold tabular-nums tracking-tight",
                  TONE_VALUE[item.tone],
                )}
              >
                {item.count.toLocaleString("en-US")}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {item.hint}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
