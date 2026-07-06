"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function TypedText({
  text,
  speedMs = 40,
  className,
  showCursor = true,
}: {
  text: string;
  speedMs?: number;
  className?: string;
  showCursor?: boolean;
}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Reset typewriter when source text changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- text prop reset
    setDisplayed("");
    setDone(false);
    if (!text) return;

    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        setDone(true);
      }
    }, speedMs);

    return () => window.clearInterval(id);
  }, [text, speedMs]);

  return (
    <span className={cn("font-mono text-xs tracking-[0.12em] text-muted-foreground", className)}>
      {displayed}
      {showCursor && !done ? (
        <span className="cursor-blink ml-0.5 inline-block h-[1em] w-[0.55ch] bg-primary align-middle" />
      ) : null}
    </span>
  );
}
