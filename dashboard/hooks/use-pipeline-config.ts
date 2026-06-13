"use client";

import { useEffect, useState } from "react";
import type { PipelineConfig } from "@/lib/types";

const EMPTY: PipelineConfig = { markets: [], categories: [], campaigns: [] };

export function usePipelineConfig(): { config: PipelineConfig; loaded: boolean } {
  const [config, setConfig] = useState<PipelineConfig>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: PipelineConfig) => {
        if (!cancelled && data.markets) {
          setConfig(data);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loaded };
}
