"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock ms that ticks on an interval. Starts at 0 so SSR and the first
 * client paint match; the first real timestamp is scheduled (not sync-in-effect).
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const boot = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return now;
}
