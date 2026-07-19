"use client";

import { useEffect } from "react";

/**
 * Dev-only: swallow ChunkLoadError noise. Never auto-reload — that caused
 * Safari GET / storms when Turbopack HMR chunks failed.
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const isChunkNoise = (reason: unknown) => {
      const text =
        reason instanceof Error
          ? `${reason.name} ${reason.message}`
          : String(reason ?? "");
      const lower = text.toLowerCase();
      return (
        lower.includes("chunkloaderror") ||
        lower.includes("failed to load chunk") ||
        lower.includes("loading chunk")
      );
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkNoise(event.reason)) return;
      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return null;
}
