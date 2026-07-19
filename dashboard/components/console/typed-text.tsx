"use client";

import { cn } from "@/lib/utils";

/**
 * Status line under the hero. Kept static so HMR / remounts do not re-run a
 * typewriter and flash the home page.
 */
export function TypedText({
  text,
  className,
  showCursor = false,
}: {
  text: string;
  speedMs?: number;
  className?: string;
  showCursor?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs tracking-[0.12em] text-muted-foreground",
        className,
      )}
    >
      {text}
      {showCursor ? (
        <span className="cursor-blink ml-0.5 inline-block h-[1em] w-[0.55ch] bg-primary align-middle" />
      ) : null}
    </span>
  );
}
