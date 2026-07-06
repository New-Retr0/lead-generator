"use client";

import { cn } from "@/lib/utils";

export function SectionHeading({
  index,
  title,
  className,
}: {
  index: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <span className="shrink-0 font-mono text-[10px] tracking-[0.3em] text-primary">
        [{index}]
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <h2 className="shrink-0 font-mono text-[11px] tracking-[0.2em] text-foreground">
        {title}
      </h2>
    </div>
  );
}
