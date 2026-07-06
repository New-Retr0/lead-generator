"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function AsciiSpinner({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => window.clearInterval(id);
  }, [reduced]);

  if (reduced) {
    return (
      <span className={cn("font-mono text-primary", className)} aria-hidden>
        ●
      </span>
    );
  }

  return (
    <span className={cn("font-mono text-primary", className)} aria-hidden>
      {FRAMES[frame]}
    </span>
  );
}
