"use client";

import { useEffect, useState } from "react";
import { useHydrated, useSafeReducedMotion } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function AsciiSpinner({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const reduced = useSafeReducedMotion();
  const [frame, setFrame] = useState(0);
  // Keep a static glyph through SSR/hydration so the tree never swaps.
  const animate = hydrated && !reduced;

  useEffect(() => {
    if (!animate) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => window.clearInterval(id);
  }, [animate]);

  return (
    <span className={cn("font-mono text-primary", className)} aria-hidden>
      {animate ? FRAMES[frame] : "●"}
    </span>
  );
}
