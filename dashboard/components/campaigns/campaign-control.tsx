"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  Link2,
  Play,
  Plus,
  Rocket,
  X,
} from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { queueLayout } from "@/components/console/motion";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { CampaignLivePanel } from "@/components/campaign-live-panel";
import { Stagger, StaggerItem } from "@/components/animated";
import {
  CampaignConfigDialog,
  type CampaignConfigState,
} from "@/components/campaigns/campaign-config-dialog";
import {
  EstimateBreakdown,
  type EstimateBreakdownData,
  type FirecrawlEstimateBalance,
} from "@/components/campaigns/estimate-breakdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { apiFetch } from "@/lib/api-client";
import { cn, formatCredits, formatUsd } from "@/lib/utils";
import type { JobStatus } from "@/lib/types";

const STATE_CAMPAIGNS = [
  { key: "central_valley", label: "CV-A", name: "Central Valley Tier A" },
  {
    key: "central_valley_franchise",
    label: "CV-F",
    name: "Central Valley Franchise",
  },
  { key: "hawaii", label: "HI", name: "Hawaii" },
  { key: "oregon", label: "OR", name: "Oregon" },
  { key: "washington", label: "WA", name: "Washington" },
  { key: "california_expansion", label: "CA", name: "California (excl LA/OC)" },
  { key: "nevada", label: "NV", name: "Nevada" },
  { key: "arizona", label: "AZ", name: "Arizona" },
  { key: "new_mexico", label: "NM", name: "New Mexico" },
] as const;

const STAGED_STORAGE_KEY = "campaign-control-staged-v1";
const STAGED_STORAGE_FALLBACK_KEYS = ["campaign-control-staged", "campaign-control-queue"];
const STORAGE_STATE_KEYS: Set<string> = new Set(STATE_CAMPAIGNS.map((state) => state.key));
const STAGED_STORAGE_VERSION = 2;
const STAGED_STORAGE_PREFERRED_KEYS = [STAGED_STORAGE_KEY, ...STAGED_STORAGE_FALLBACK_KEYS];
const JOB_DONE_STATUSES: Set<JobStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);

type CampaignInfo = {
  key: string;
  description: string;
  markets: { key: string; city: string; state: string }[];
  categories: string[];
};

type CreditsData = {
  firecrawl: FirecrawlEstimateBalance & {
    queue?: {
      jobsInQueue: number | null;
      maxConcurrency: number | null;
      live: boolean;
    };
  };
};

type EstimateData = EstimateBreakdownData;

type StagedStatus = "staged" | "running" | "done" | "failed";

type StagedCampaign = {
  campaign: string;
  config: CampaignConfigState;
  status: StagedStatus;
  jobId?: string;
};

type CampaignStageEnvelope = {
  v?: number;
  staged?: unknown;
  updatedAt?: string;
  timestamp?: string;
  payload?: unknown;
};

const DEFAULT_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown): StagedStatus {
  if (value === "done" || value === "failed" || value === "running") return value;
  return "staged";
}

function parseStoredConfig(value: unknown): CampaignConfigState | null {
  if (!isRecord(value)) return null;
  const selectedMarkets = Array.isArray(value.selectedMarkets)
    ? value.selectedMarkets.filter((item): item is string => typeof item === "string")
    : [];
  const selectedCategories = Array.isArray(value.selectedCategories)
    ? value.selectedCategories.filter((item): item is string => typeof item === "string")
    : [];
  const limitValue = typeof value.limit === "number" ? Math.floor(value.limit) : DEFAULT_LIMIT;
  const limit = Number.isFinite(limitValue) ? Math.max(1, limitValue) : DEFAULT_LIMIT;
  const discoverOnly = typeof value.discoverOnly === "boolean" ? value.discoverOnly : false;

  return {
    selectedMarkets,
    selectedCategories,
    limit,
    discoverOnly,
  };
}

function extractStagedPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.staged)) {
    return value.staged;
  }
  if (Array.isArray(value.payload)) {
    return value.payload;
  }
  if (Array.isArray(value.items)) {
    return value.items;
  }
  if (Array.isArray(value.queue)) {
    return value.queue;
  }

  return [];
}

function parseStagePayloadTimestamp(value: CampaignStageEnvelope | null): number {
  const candidate = value?.updatedAt ?? value?.timestamp;
  if (!candidate) return 0;
  const parsed = new Date(candidate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeStorageGet(key: string): string | null {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const value = storage.getItem(key);
      if (value != null) {
        return value;
      }
    } catch {
      // Some browsers block storage while preserving app runtime.
    }
  }
  return null;
}

function safeStorageSet(key: string, value: string) {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.setItem(key, value);
    } catch {
      // Keep going if a store is unavailable or blocked.
    }
  }
}

function alignConfigWithCampaign(config: CampaignConfigState, campaign: CampaignInfo): CampaignConfigState {
  const marketKeys = new Set(campaign.markets.map((market) => market.key));
  const categoryKeys = new Set(campaign.categories);
  const fallback = defaultConfigForCampaign(campaign);

  const selectedMarkets = config.selectedMarkets.filter((market) => marketKeys.has(market));
  const selectedCategories = config.selectedCategories.filter((category) =>
    categoryKeys.has(category),
  );

  return {
    selectedMarkets: selectedMarkets.length > 0 ? selectedMarkets : fallback.selectedMarkets,
    selectedCategories: selectedCategories.length > 0 ? selectedCategories : fallback.selectedCategories,
    limit: Math.max(1, Math.min(config.limit, 500)),
    discoverOnly: config.discoverOnly,
  };
}

function loadStagedFromStorage(): StagedCampaign[] {
  if (typeof window === "undefined") return [];
  const savedKeys = STAGED_STORAGE_PREFERRED_KEYS;
  const parsedItems: unknown[] = [];
  let bestPayload: unknown[] = [];
  let bestPayloadTs = 0;

  for (const key of savedKeys) {
    const saved = safeStorageGet(key);
    if (!saved) continue;
    try {
      const parsed = JSON.parse(saved);
      const payload = extractStagedPayload(parsed);
      if (payload.length > 0) {
        const envelope = isRecord(parsed) ? (parsed as CampaignStageEnvelope) : null;
        const ts = parseStagePayloadTimestamp(envelope);
        if (ts >= bestPayloadTs) {
          bestPayloadTs = ts;
          bestPayload = payload;
        }
        parsedItems.push(...payload);
      }
    } catch {
      // Ignore malformed persisted queues from prior releases.
    }
  }

  const prioritizedItems = bestPayload.length > 0 ? [...bestPayload, ...parsedItems] : parsedItems;
  if (prioritizedItems.length === 0) return [];

  const deduped = new Map<string, unknown>();
  try {
    for (const item of prioritizedItems) {
      if (!isRecord(item)) continue;
      if (typeof item.campaign !== "string" || !STORAGE_STATE_KEYS.has(item.campaign)) continue;
      if (deduped.has(item.campaign)) continue;
      deduped.set(item.campaign, item);
    }

    const result: StagedCampaign[] = [];
    for (const [campaign, rawItem] of deduped.entries()) {
      if (!isRecord(rawItem)) continue;
      const config = parseStoredConfig(rawItem.config);
      if (!config) continue;
      result.push({
        campaign,
        config,
        status: normalizeStatus(rawItem.status),
        jobId: typeof rawItem.jobId === "string" ? rawItem.jobId : undefined,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function saveStagedToStorage(staged: StagedCampaign[]) {
  if (typeof window === "undefined") return;
  const savedKeys = STAGED_STORAGE_PREFERRED_KEYS;
  try {
    const payload = JSON.stringify({
      v: STAGED_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      staged,
    } satisfies CampaignStageEnvelope);
    for (const key of savedKeys) {
      safeStorageSet(key, payload);
    }
  } catch {
    // Ignore persistence failures, they only affect local queue restore.
  }
}

function normalizeStagedWithCampaigns(
  items: StagedCampaign[],
  campaigns: CampaignInfo[],
): StagedCampaign[] {
  const byKey = new Map<string, CampaignInfo>(campaigns.map((campaign) => [campaign.key, campaign]));
  const next: StagedCampaign[] = [];
  for (const item of items) {
    const campaign = byKey.get(item.campaign);
    if (!campaign) {
      next.push(item);
      continue;
    }
    next.push({
      campaign: item.campaign,
      config: alignConfigWithCampaign(item.config, campaign),
      status: item.status,
      jobId: item.jobId,
    });
  }
  return next;
}

function mergeStagedWithStorage(
  staged: StagedCampaign[],
  fromStorage: StagedCampaign[],
): StagedCampaign[] {
  if (fromStorage.length === 0) return staged;
  const byCampaign = new Map(fromStorage.map((item) => [item.campaign, item]));
  const merged = staged.map((item) => byCampaign.get(item.campaign) ?? item);
  const existing = new Set(staged.map((item) => item.campaign));

  for (const [campaign, item] of byCampaign) {
    if (!existing.has(campaign)) merged.push(item);
  }

  return merged;
}

async function hydrateRunningStatus(item: StagedCampaign): Promise<StagedCampaign> {
  if (item.status !== "running") return item;
  if (!item.jobId) {
    return { ...item, status: "staged" };
  }

  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(item.jobId)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { ...item, status: "staged" };
    }
    const data = (await res.json()) as { job?: { status?: string } };
    const status = data.job?.status;

    if (status === "completed") return { ...item, status: "done" };
    if (status && JOB_DONE_STATUSES.has(status as JobStatus)) {
      return { ...item, status: "failed" };
    }
    if (status === "running" || status === "pending") {
      return { ...item, status: "running" };
    }
    return item;
  } catch {
    return item;
  }
}

async function hydrateStagedStatuses(staged: StagedCampaign[]): Promise<StagedCampaign[]> {
  if (staged.length === 0) return staged;
  const next = await Promise.all(staged.map(hydrateRunningStatus));
  return next;
}

function defaultConfigForCampaign(info: CampaignInfo): CampaignConfigState {
  return {
    selectedMarkets: info.markets.map((m) => m.key),
    selectedCategories: [...info.categories],
    limit: DEFAULT_LIMIT,
    discoverOnly: false,
  };
}

function stageMeta(campaign: string) {
  return STATE_CAMPAIGNS.find((state) => state.key === campaign);
}

function isConfigRunnable(config: CampaignConfigState | undefined) {
  return Boolean(
    config &&
      config.selectedMarkets.length > 0 &&
      config.selectedCategories.length > 0 &&
      config.limit >= 1,
  );
}

function argValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const value = args[idx + 1];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Resolve matrix axes for a local job that was not launched from this browser queue. */
function axesFromJobArgs(
  args: string[],
  campaigns: CampaignInfo[],
): { campaign: string | null; markets: string[]; categories: string[] } {
  const campaign = argValue(args, "--campaign");
  const marketRaw = argValue(args, "--market");
  const categoryRaw = argValue(args, "--category");
  const info = campaign ? campaigns.find((c) => c.key === campaign) : undefined;
  const markets = marketRaw
    ? marketRaw.split(",").map((m) => m.trim()).filter(Boolean)
    : info
      ? info.markets.map((m) => m.key)
      : [];
  const categories = categoryRaw
    ? categoryRaw.split(",").map((c) => c.trim()).filter(Boolean)
    : info
      ? [...info.categories]
      : [];
  return { campaign, markets, categories };
}

export function CampaignControl() {
  // Avoid SSR/client tree swaps from prefers-reduced-motion resolving late.
  const reducedMotion = useSafeReducedMotion();
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [selected, setSelected] = useState<string>("central_valley");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stateConfigs, setStateConfigs] = useState<Record<string, CampaignConfigState>>({});
  const [stateEstimates, setStateEstimates] = useState<Record<string, EstimateData | null>>({});
  const [credits, setCredits] = useState<CreditsData | null>(null);
  // Always start empty so SSR HTML matches the first client paint; hydrate from
  // localStorage after mount (see useEffect below).
  const [staged, setStaged] = useState<StagedCampaign[]>([]);
  const [stagedStorageReady, setStagedStorageReady] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [resumedNotice, setResumedNotice] = useState<string | null>(null);
  const [externalActiveJobId, setExternalActiveJobId] = useState<string | null>(null);
  const [externalJobAxes, setExternalJobAxes] = useState<{
    campaign: string | null;
    markets: string[];
    categories: string[];
  } | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const stagedRef = useRef<StagedCampaign[]>(staged);
  const campaignsRef = useRef<CampaignInfo[]>(campaigns);
  const queueAbortRef = useRef(false);

  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  useEffect(() => {
    // Defer so we don't sync-setState inside the effect body (React Compiler lint).
    const boot = window.setTimeout(() => {
      const loaded = loadStagedFromStorage();
      stagedRef.current = loaded;
      setStaged(loaded);
      setStagedStorageReady(true);
    }, 0);
    return () => window.clearTimeout(boot);
  }, []);

  useEffect(() => {
    if (!stagedStorageReady) return;
    stagedRef.current = staged;
    saveStagedToStorage(staged);
  }, [staged, stagedStorageReady]);

  useEffect(() => {
    const persistNow = () => {
      saveStagedToStorage(stagedRef.current);
    };
    const handleBeforeUnload = () => {
      persistNow();
    };
    const handleBlur = () => {
      persistNow();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    };

    window.addEventListener("pagehide", persistNow, { capture: true });
    window.addEventListener("unload", persistNow);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("popstate", persistNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow, { capture: true });
      window.removeEventListener("unload", persistNow);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("popstate", persistNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const setStagedPersistently = useCallback((updater: (prev: StagedCampaign[]) => StagedCampaign[]) => {
    const next = updater(stagedRef.current);
    stagedRef.current = next;
    saveStagedToStorage(next);
    setStaged(next);
  }, []);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.key === selected),
    [campaigns, selected],
  );

  const selectedConfig = stateConfigs[selected];

  const estimateForConfig = useCallback(
    async (
      campaignKey: string,
      config: CampaignConfigState,
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        campaign: campaignKey,
        markets: config.selectedMarkets.join(","),
        categories: config.selectedCategories.join(","),
        limit: String(config.limit),
      });
      const body = (await fetch(`/api/campaigns/estimate?${params}`, { signal }).then((r) =>
        r.json(),
      )) as EstimateData;
      return body;
    },
    [],
  );

  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    try {
      const [campRes, credRes] = await Promise.all([
        fetch("/api/campaigns", { signal }),
        fetch("/api/credits", { signal }),
      ]);
      if (signal?.aborted) return;
      if (!campRes.ok || !credRes.ok) {
        return;
      }
      const campBody = (await campRes.json()) as { campaigns?: CampaignInfo[] };
      const credBody = (await credRes.json()) as CreditsData;
      if (signal?.aborted) return;

      const loaded = campBody.campaigns ?? [];
      const defaultConfigs: Record<string, CampaignConfigState> = {};
      for (const state of STATE_CAMPAIGNS) {
        const info = loaded.find((c) => c.key === state.key);
        if (info) defaultConfigs[state.key] = defaultConfigForCampaign(info);
      }
      if (loaded.length > 0) {
        setCampaigns(loaded);
        const restored = normalizeStagedWithCampaigns(stagedRef.current, loaded);
        const hydrated = await hydrateStagedStatuses(restored);
        if (signal?.aborted) return;
        setStagedPersistently((prev) => mergeStagedWithStorage(prev, hydrated));
      }
      setCredits(credBody);
      setStateConfigs((prev) => {
        const next = { ...prev };
        for (const state of STATE_CAMPAIGNS) {
          if (!defaultConfigs[state.key] || next[state.key]) continue;
          next[state.key] = defaultConfigs[state.key];
        }
        return next;
      });

      // Stagger card estimates after first paint — selected campaign has its own effect.
      const queue = STATE_CAMPAIGNS.filter((state) => defaultConfigs[state.key]);
      for (const state of queue) {
        if (signal?.aborted) return;
        const cfg = defaultConfigs[state.key];
        if (!cfg) continue;
        try {
          const body = await estimateForConfig(state.key, cfg, signal);
          if (signal?.aborted) return;
          setStateEstimates((prev) => ({ ...prev, [state.key]: body }));
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to load campaign metadata", err);
    }
  }, [estimateForConfig, setStagedPersistently]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch populates campaign metadata
    void loadMeta(controller.signal);
    return () => {
      if (!controller.signal.aborted) {
        try {
          controller.abort("campaign-control-route-unmount");
        } catch {
          // Ignore abort edge-cases; cleanup should never fail.
        }
      }
    };
  }, [loadMeta]);

  useEffect(() => {
    if (!selectedConfig) return;
    if (!isConfigRunnable(selectedConfig)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- invalid local selections clear the displayed estimate
      setStateEstimates((prev) => ({ ...prev, [selected]: null }));
      return;
    }

    let controller: AbortController | null = null;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      controller = new AbortController();
      estimateForConfig(selected, selectedConfig, controller.signal)
        .then((body) => {
          if (cancelled) return;
          setStateEstimates((prev) => ({ ...prev, [selected]: body }));
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("Failed to estimate campaign", err);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      cancelled = true;
      if (controller && !controller.signal.aborted) {
        try {
          controller.abort("campaign estimate superseded");
        } catch {
          // Ignore abort edge-cases; cleanup should never block navigation.
        }
      }
    };
  }, [estimateForConfig, selected, selectedConfig]);

  const selectState = useCallback((campaignKey: string) => {
    setSelected(campaignKey);
  }, []);

  const openState = useCallback(
    (campaignKey: string) => {
      selectState(campaignKey);
      setDialogOpen(true);
    },
    [selectState],
  );

  const updateStateConfig = useCallback(
    (campaignKey: string, patch: Partial<CampaignConfigState>) => {
      setStateConfigs((prev) => {
        const current = prev[campaignKey];
        if (!current) return prev;
        return { ...prev, [campaignKey]: { ...current, ...patch } };
      });
    },
    [],
  );

  const estimate = stateEstimates[selected] ?? null;

  const budgetPct = useMemo(() => {
    if (!credits?.firecrawl.remaining || !estimate?.estimatedCredits) return 0;
    return Math.min(100, (estimate.estimatedCredits / credits.firecrawl.remaining) * 100);
  }, [credits, estimate]);

  const marketsSelected = useMemo(
    () =>
      STATE_CAMPAIGNS.reduce(
        (n, s) => n + (stateConfigs[s.key]?.selectedMarkets.length ?? 0),
        0,
      ),
    [stateConfigs],
  );

  const launchCampaign = useCallback(
    async (campaignKey: string, config: CampaignConfigState) => {
      const body: Record<string, unknown> = {
        runType: "run-campaign",
        campaign: campaignKey,
        limit: config.limit,
        discoverOnly: config.discoverOnly,
      };
      if (config.selectedMarkets.length > 0) {
        body.market = config.selectedMarkets.join(",");
      }
      if (config.selectedCategories.length > 0) {
        body.category = config.selectedCategories.join(",");
      }

      const res = await apiFetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start campaign");
      }
      return data.jobId ?? "";
    },
    [],
  );

  const waitForJob = useCallback((jobId: string) => {
    return new Promise<StagedStatus>((resolve) => {
      const poll = async () => {
        if (queueAbortRef.current) {
          resolve("failed");
          return;
        }
        try {
          const response = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`);
          const payload = (await response.json()) as { job?: { status?: string } };
          const jobStatus = payload.job?.status;
          if (jobStatus === "completed") {
            resolve("done");
            return;
          }
          if (
            jobStatus === "failed" ||
            jobStatus === "cancelled" ||
            jobStatus === "interrupted"
          ) {
            resolve("failed");
            return;
          }
        } catch {
          // A transient poll error must not mark a still-running paid job as failed.
        }
        window.setTimeout(() => void poll(), 2_000);
      };
      void poll();
    });
  }, []);

  const updateStaged = useCallback(
    (campaignKey: string, patch: Partial<StagedCampaign>) => {
      setStagedPersistently((prev) =>
        prev.map((item) =>
          item.campaign === campaignKey ? { ...item, ...patch } : item,
        ),
      );
    },
    [setStagedPersistently],
  );

  const executeStaged = useCallback(
    async (item: StagedCampaign) => {
      const jobId = await launchCampaign(item.campaign, item.config);
      activeJobRef.current = jobId;
      updateStaged(item.campaign, { jobId, status: "running" });
      const status = await waitForJob(jobId);
      activeJobRef.current = null;
      updateStaged(item.campaign, { status });
      if (status === "done") {
        toast.success(`${item.campaign} finished`);
      } else {
        toast.error(`${item.campaign} failed`);
      }
      return status === "done";
    },
    [launchCampaign, updateStaged, waitForJob],
  );

  const runOne = useCallback(
    async (item: StagedCampaign) => {
      if (launching || item.status === "running") return;
      setLaunching(true);
      try {
        await executeStaged(item);
      } catch (err) {
        updateStaged(item.campaign, { status: "failed" });
        toast.error(err instanceof Error ? err.message : "Launch failed");
      } finally {
        activeJobRef.current = null;
        setLaunching(false);
      }
    },
    [executeStaged, launching, updateStaged],
  );

  const launchQueue = useCallback(async () => {
    if (launching || activeJobRef.current) return;
    queueAbortRef.current = false;
    setLaunching(true);
    try {
      while (!queueAbortRef.current) {
        const next = stagedRef.current.find((item) => item.status === "staged");
        if (!next) break;
        const ok = await executeStaged(next);
        if (!ok || queueAbortRef.current) break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Launch queue failed");
    } finally {
      activeJobRef.current = null;
      setLaunching(false);
    }
  }, [executeStaged, launching]);

  useEffect(() => {
    queueAbortRef.current = false;
    return () => {
      // Stop auto-advancing the launch queue when leaving Launch.
      queueAbortRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncActiveJobs = async () => {
      try {
        const res = await apiFetch("/api/runs", { cache: "no-store" });
        const data = (await res.json()) as {
          jobs?: { id: string; status: string; kind?: string }[];
        };
        if (cancelled) return;
        const live = (data.jobs ?? []).filter(
          (j) =>
            (j.status === "running" || j.status === "pending") &&
            j.kind !== "doctor",
        );
        const stagedIds = new Set(
          stagedRef.current
            .filter((item) => item.jobId)
            .map((item) => item.jobId as string),
        );
        const external = live.find((j) => !stagedIds.has(j.id));
        setExternalActiveJobId(external?.id ?? null);

        let resolvedAxes: {
          campaign: string | null;
          markets: string[];
          categories: string[];
        } | null = null;
        if (external?.id) {
          try {
            const jobRes = await apiFetch(
              `/api/jobs/${encodeURIComponent(external.id)}`,
              { cache: "no-store" },
            );
            const jobBody = (await jobRes.json()) as {
              job?: { args?: string[] };
            };
            resolvedAxes = axesFromJobArgs(
              jobBody.job?.args ?? [],
              campaignsRef.current,
            );
          } catch {
            resolvedAxes = null;
          }
        }
        if (!cancelled) setExternalJobAxes(resolvedAxes);

        const resumed = stagedRef.current.find(
          (item) => item.status === "running" && item.jobId,
        );
        if (resumed?.jobId) {
          setResumedNotice(
            `Resumed local execution · ${resumed.campaign.replace(/_/g, " ")}`,
          );
        } else if (external) {
          const label = resolvedAxes?.campaign ?? "active job";
          setResumedNotice(
            `Active local execution · ${String(label).replace(/_/g, " ")} (not in this browser queue)`,
          );
        } else {
          setResumedNotice(null);
        }
      } catch {
        // ignore
      }
    };
    void syncActiveJobs();
    const id = window.setInterval(() => void syncActiveJobs(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const stageCampaign = useCallback(
    (campaignKey: string, config: CampaignConfigState) => {
      if (!isConfigRunnable(config)) {
        toast.error("Select at least one market and one category");
        return false;
      }
      if (
        stagedRef.current.some((item) => item.campaign === campaignKey && item.status === "running")
      ) {
        toast.error("This campaign is already running");
        return false;
      }
      setStagedPersistently((prev) => {
        const nextItem: StagedCampaign = {
          campaign: campaignKey,
          config,
          status: "staged",
        };
        const existing = prev.findIndex((item) => item.campaign === campaignKey);
        if (existing === -1) return [...prev, nextItem];
        return prev.map((item) => (item.campaign === campaignKey ? nextItem : item));
      });
      toast.success("Saved to Launch Control", {
        description: `${campaignKey} - ${config.selectedMarkets.length} markets`,
      });
      return true;
    },
    [setStagedPersistently],
  );

  const removeStaged = useCallback((campaignKey: string) => {
    setStagedPersistently((prev) => prev.filter((item) => item.campaign !== campaignKey));
  }, [setStagedPersistently]);

  const stagedReadyCount = staged.filter((item) => item.status === "staged").length;
  const activeStaged = staged.find((item) => item.status === "running" && item.jobId);
  const panelJobId = activeStaged?.jobId ?? externalActiveJobId;
  const panelCampaign =
    activeStaged?.campaign ??
    externalJobAxes?.campaign ??
    (externalActiveJobId ? "active_job" : selected);
  const panelMarkets =
    activeStaged?.config.selectedMarkets ??
    (externalActiveJobId && externalJobAxes?.markets.length
      ? externalJobAxes.markets
      : null) ??
    selectedConfig?.selectedMarkets ??
    [];
  const panelCategories =
    activeStaged?.config.selectedCategories ??
    (externalActiveJobId && externalJobAxes?.categories.length
      ? externalJobAxes.categories
      : null) ??
    selectedConfig?.selectedCategories ??
    [];
  const selectedStateMeta = STATE_CAMPAIGNS.find((s) => s.key === selected);

  return (
    <div className="space-y-5">
      <section className="relative min-h-[13rem] overflow-hidden rounded-xl border border-border/50 bg-card md:min-h-[15rem]">
        <div className="pointer-events-none absolute bottom-0 right-0 flex h-full w-[min(58%,22rem)] items-end justify-center md:w-[min(50%,26rem)]">
          <ASCIIAnimation
            frameFolder="planet"
            frameCount={200}
            quality="medium"
            fps={30}
            className="h-[92%] w-full [mask-image:linear-gradient(to_left,black_65%,transparent_100%)] [&_pre]:-translate-y-[7%]"
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy={false}
            ariaLabel="Rotating earth"
          />
        </div>
        <div className="relative z-10 flex min-h-[13rem] flex-col justify-between gap-4 p-5 md:min-h-[15rem] md:p-6">
          <div className="max-w-xl space-y-2 pr-4 md:pr-8">
            <SectionHeading index="01" title="Campaign Control" />
            <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
              {STATE_CAMPAIGNS.length} presets · {marketsSelected} markets selected ·{" "}
              {estimate?.estimatedCredits != null
                ? `${formatCredits(estimate.estimatedCredits)} cr estimated`
                : "select a state to estimate"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              Firecrawl{" "}
              {credits?.firecrawl.remaining != null
                ? formatCredits(credits.firecrawl.remaining)
                : "—"}
            </Badge>
            {credits?.firecrawl.planName ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {credits.firecrawl.planName}
              </Badge>
            ) : null}
            {staged.length > 0 ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {stagedReadyCount} staged
              </Badge>
            ) : null}
          </div>
        </div>
      </section>

      <SectionReveal>
        <Card className="panel sm:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
              Estimated burn - {selectedStateMeta?.label ?? selected}
            </CardTitle>
            <CardDescription>
              {selectedConfig
                ? `${selectedConfig.selectedMarkets.length} markets x ${selectedConfig.selectedCategories.length} categories x ${selectedConfig.limit} limit`
                : "Click a state card to configure"}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[11rem] space-y-4">
            <EstimateBreakdown estimate={estimate} firecrawlBalance={credits?.firecrawl} />
            <Progress
              value={budgetPct}
              className={cn("h-2", budgetPct > 80 && "[&>div]:bg-destructive")}
            />
            {budgetPct > 80 ? (
              <p className="flex items-center gap-1 font-mono text-[10px] text-destructive">
                <AlertTriangle className="size-3" />
                Estimate exceeds 80% of remaining Firecrawl credits
              </p>
            ) : null}
          </CardContent>
        </Card>
      </SectionReveal>

      <SectionReveal>
        <SectionHeading index="02" title="Campaign presets" className="mb-4" />
        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {STATE_CAMPAIGNS.map((state) => {
            const info = campaigns.find((c) => c.key === state.key);
            const config = stateConfigs[state.key];
            const stagedItem = staged.find((q) => q.campaign === state.key);
            const cardEstimate = stateEstimates[state.key];
            const runnable = isConfigRunnable(config);

            return (
              <StaggerItem key={state.key}>
                <div
                  data-selected={selected === state.key || undefined}
                  onClick={() => selectState(state.key)}
                  className={cn(
                    "hover-lift panel w-full cursor-pointer rounded-xl border p-4 text-left transition-colors",
                    selected === state.key && "border-primary/50 ring-1 ring-primary/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-bold tracking-[0.15em]">
                      {state.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {stagedItem ? (
                        <Badge variant="outline" className="font-mono text-[9px] uppercase">
                          {stagedItem.status}
                        </Badge>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Configure ${state.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openState(state.key);
                            }}
                          >
                            <ArrowUpRight className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit setup.</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{state.name}</p>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    {info && config
                      ? `${config.selectedMarkets.length} markets - ${config.selectedCategories.length} categories - limit ${config.limit}`
                      : "..."}
                  </p>
                  {cardEstimate?.estimatedCredits != null ? (
                    <p className="mt-2 font-mono text-[10px] tabular-nums text-warning">
                      {formatCredits(cardEstimate.estimatedCredits)} cr
                      {cardEstimate.estimatedUsd != null
                        ? ` - ${formatUsd(cardEstimate.estimatedUsd)}`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                      estimating...
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!runnable || launching}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (config) stageCampaign(state.key, config);
                            }}
                          >
                            <Plus className="size-3.5" />
                            Stage
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Add to staging.</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </SectionReveal>

      {selectedCampaign && selectedConfig && selectedStateMeta ? (
        <CampaignConfigDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          stateKey={selected}
          stateLabel={selectedStateMeta.label}
          stateName={selectedStateMeta.name}
          markets={selectedCampaign.markets}
          categories={selectedCampaign.categories}
          config={selectedConfig}
          estimate={estimate}
          firecrawlBalance={credits?.firecrawl}
          launching={launching}
          onChange={(patch) => updateStateConfig(selected, patch)}
          onSaveToLaunchControl={() => {
            if (!selectedConfig) return;
            if (stageCampaign(selected, selectedConfig)) setDialogOpen(false);
          }}
        />
      ) : null}

      <SectionReveal>
        <SectionHeading index="03" title="Launch Control" className="mb-4" />
        <Card className="panel">
          <CardContent className="space-y-5 py-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="max-w-2xl space-y-1">
                <p className="font-mono text-xs text-muted-foreground">
                  Stage states here, then run one by itself or launch the connected queue one at a
                  time. Launch queue auto-starts the next staged campaign after each finishes.
                </p>
                {resumedNotice ? (
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                    {resumedNotice}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        onClick={() => void launchQueue()}
                        disabled={launching || stagedReadyCount === 0}
                      >
                        <Link2 className="size-3.5" />
                        Launch queue
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Run connected items.</TooltipContent>
                </Tooltip>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/runs">
                    <Play className="size-3.5" />
                    View runs
                  </Link>
                </Button>
              </div>
            </div>

            {staged.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card/40 px-4 py-6 text-sm text-muted-foreground">
                No states staged. Configure a state card, then save it to Launch Control.
              </div>
            ) : (
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
                <AnimatePresence initial={false}>
                  {staged.map((item, index) => {
                    const meta = stageMeta(item.campaign);
                    const running = item.status === "running";
                    const connectorIntoRunning = index > 0 && running;
                    return (
                      <motion.div
                        key={item.campaign}
                        layout
                        initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reducedMotion ? undefined : { opacity: 0, y: -8, scale: 0.96 }}
                        transition={queueLayout.card}
                        className="flex flex-col items-center gap-3 sm:flex-row"
                      >
                        {index > 0 ? (
                          reducedMotion ? (
                            <span
                              className="h-6 w-px shrink-0 rounded-full bg-border sm:h-px sm:w-8"
                              aria-hidden
                            />
                          ) : connectorIntoRunning ? (
                            <motion.span
                              key={`connector-${item.campaign}`}
                              className="h-6 w-px shrink-0 origin-top rounded-full bg-primary sm:h-px sm:w-8 sm:origin-left"
                              initial={{ scaleY: 0, scaleX: 0, opacity: 0.4 }}
                              animate={{ scaleY: 1, scaleX: 1, opacity: 1 }}
                              transition={queueLayout.connectorPulse}
                              aria-hidden
                            />
                          ) : (
                            <span
                              className="h-6 w-px shrink-0 rounded-full bg-border/80 sm:h-px sm:w-8"
                              aria-hidden
                            />
                          )
                        ) : null}
                        <div
                          className={cn(
                            "w-full min-w-56 rounded-xl border bg-card p-3 shadow-sm sm:w-auto",
                            running && "border-primary/60 bg-primary/5",
                            item.status === "failed" && "border-destructive/50",
                            item.status === "done" && "border-success/50",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-sm font-bold tracking-[0.12em]">
                                {meta?.label ?? item.campaign}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {item.config.selectedMarkets.length} markets -{" "}
                                {item.config.selectedCategories.length} categories - limit{" "}
                                {item.config.limit}
                              </p>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={running}
                                  aria-label={`Remove ${meta?.name ?? item.campaign} from queue`}
                                  onClick={() => removeStaged(item.campaign)}
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove from queue.</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <Badge variant="outline" className="font-mono text-[9px] uppercase">
                              {item.status}
                            </Badge>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={launching || item.status === "done" || running}
                                    onClick={() => void runOne(item)}
                                  >
                                    <Rocket className="size-3.5" />
                                    Run now
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Run this item.</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
            {panelJobId ? (
              <div className="border-t border-border/50 pt-5">
                <CampaignLivePanel
                  jobId={panelJobId}
                  campaign={panelCampaign}
                  markets={panelMarkets}
                  categories={panelCategories}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </SectionReveal>

      <SectionReveal>
        <Card className="panel border-dashed">
          <CardHeader>
            <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
              Multi-state population sequence
            </CardTitle>
            <CardDescription>
              Stage states deliberately and check costs before continuing west.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs leading-relaxed text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-4">
              <li>Start with Hawaii as the smallest campaign quality check.</li>
              <li>Review run costs on the Costs page after each state or queue batch.</li>
              <li>
                Continue sequentially: Oregon, Washington, California expansion, Nevada,
                Arizona, New Mexico.
              </li>
            </ol>
          </CardContent>
        </Card>
      </SectionReveal>
    </div>
  );
}
