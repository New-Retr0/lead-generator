"use client";

import { useEffect, useRef } from "react";

/**
 * setInterval that pauses while the document is hidden (background tab).
 * Avoids burning Postgres/API while the operator console sits idle in another tab.
 */
export function useVisibilityInterval(
  callback: () => void,
  delayMs: number | null,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || delayMs == null || delayMs <= 0) return;

    let id: number | null = null;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      callbackRef.current();
    };

    const start = () => {
      if (id != null) return;
      id = window.setInterval(tick, delayMs);
    };

    const stop = () => {
      if (id == null) return;
      window.clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      tick();
      start();
    };

    if (document.visibilityState !== "hidden") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [delayMs, enabled]);
}
