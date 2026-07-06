"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Play } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { Stagger, StaggerItem } from "@/components/animated";
import {
  CampaignConfigDialog,
  type CampaignConfigState,
} from "@/components/campaigns/campaign-config-dialog";
import {
  EstimateBreakdown,
  type EstimateBreakdownData,
} from "@/components/campaigns/estimate-breakdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, formatCredits, formatUsd } from "@/lib/utils";

const STATE_CAMPAIGNS = [
  { key: "hawaii", label: "HI", name: "Hawaii" },
  { key: "oregon", label: "OR", name: "Oregon" },
  { key: "washington", label: "WA", name: "Washington" },
  { key: "california_expansion", label: "CA", name: "California (excl LA/OC)" },
  { key: "nevada", label: "NV", name: "Nevada" },
  { key: "arizona", label: "AZ", name: "Arizona" },
  { key: "new_mexico", label: "NM", name: "New Mexico" },
] as const;

type CampaignInfo = {
  key: string;
  description: string;
  markets: { key: string; city: string; state: string }[];
  categories: string[];
};

type CreditsData = {
  firecrawl: { remaining: number | null; plan: number | null; live: boolean };
  aiGateway: { balanceUsd: number | null; live: boolean };
};

type EstimateData = EstimateBreakdownData;

type QueuedCampaign = {
  campaign: string;
  config: CampaignConfigState;
  status: "pending" | "running" | "done" | "failed";
  jobId?: string;
};

const DEFAULT_LIMIT = 20;

function defaultConfigForCampaign(info: CampaignInfo): CampaignConfigState {
  return {
    selectedMarkets: info.markets.map((m) => m.key),
    selectedCategories: [...info.categories],
    limit: DEFAULT_LIMIT,
    discoverOnly: false,
    maxCreditsPerRun: "",
  };
}

export function CampaignControl() {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [selected, setSelected] = useState<string>("hawaii");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stateConfigs, setStateConfigs] = useState<Record<string, CampaignConfigState>>({});
  const [stateEstimates, setStateEstimates] = useState<Record<string, EstimateData>>({});
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [queue, setQueue] = useState<QueuedCampaign[]>([]);
  const [launching, setLaunching] = useState(false);
  const activeJobRef = useRef<string | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.key === selected),
    [campaigns, selected],
  );

  const selectedConfig = stateConfigs[selected];

  const loadMeta = useCallback(async () => {
    const [campRes, credRes] = await Promise.all([
      fetch("/api/campaigns"),
      fetch("/api/credits"),
    ]);
    const campBody = (await campRes.json()) as { campaigns?: CampaignInfo[] };
    const credBody = (await credRes.json()) as CreditsData;
    const loaded = campBody.campaigns ?? [];
    setCampaigns(loaded);
    setCredits(credBody);
    setStateConfigs((prev) => {
      const next = { ...prev };
      for (const state of STATE_CAMPAIGNS) {
        const info = loaded.find((c) => c.key === state.key);
        if (!info || next[state.key]) continue;
        next[state.key] = defaultConfigForCampaign(info);
      }
      return next;
    });
    const hawaii = loaded.find((c) => c.key === "hawaii");
    if (hawaii) {
      const cfg = defaultConfigForCampaign(hawaii);
      const params = new URLSearchParams({
        campaign: "hawaii",
        markets: cfg.selectedMarkets.join(","),
        categories: cfg.selectedCategories.join(","),
        limit: String(cfg.limit),
      });
      void fetch(`/api/campaigns/estimate?${params}`)
        .then((r) => r.json())
        .then((body: EstimateData) =>
          setStateEstimates((prev) => ({ ...prev, hawaii: body })),
        );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void loadMeta();
  }, [loadMeta]);

  const fetchEstimate = useCallback(
    async (campaignKey: string, config: CampaignConfigState) => {
      if (config.selectedMarkets.length === 0 || config.selectedCategories.length === 0) {
        return;
      }
      const params = new URLSearchParams({
        campaign: campaignKey,
        markets: config.selectedMarkets.join(","),
        categories: config.selectedCategories.join(","),
        limit: String(config.limit),
      });
      const body = (await fetch(`/api/campaigns/estimate?${params}`).then((r) =>
        r.json(),
      )) as EstimateData;
      setStateEstimates((prev) => ({ ...prev, [campaignKey]: body }));
    },
    [],
  );

  const openState = useCallback(
    (campaignKey: string) => {
      setSelected(campaignKey);
      const config = stateConfigs[campaignKey];
      if (config) void fetchEstimate(campaignKey, config);
      setDialogOpen(true);
    },
    [stateConfigs, fetchEstimate],
  );

  const updateStateConfig = useCallback(
    (campaignKey: string, patch: Partial<CampaignConfigState>) => {
      setStateConfigs((prev) => {
        const current = prev[campaignKey];
        if (!current) return prev;
        const next = { ...current, ...patch };
        void fetchEstimate(campaignKey, next);
        return { ...prev, [campaignKey]: next };
      });
    },
    [fetchEstimate],
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
      const remaining = credits?.firecrawl.remaining;
      let maxCreditsPerRun: number | undefined;
      if (config.maxCreditsPerRun !== "" && Number(config.maxCreditsPerRun) > 0) {
        maxCreditsPerRun = Math.floor(Number(config.maxCreditsPerRun));
      } else if (remaining != null) {
        maxCreditsPerRun = Math.max(50, Math.floor(remaining / 8));
      }

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
      if (maxCreditsPerRun != null) {
        body.maxCreditsPerRun = maxCreditsPerRun;
      }

      const res = await fetch("/api/jobs/run", {
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
    [credits],
  );

  const processQueue = useCallback(async () => {
    if (launching || activeJobRef.current) return;
    const next = queue.find((q) => q.status === "pending");
    if (!next) return;

    setLaunching(true);
    setQueue((prev) =>
      prev.map((q) =>
        q.campaign === next.campaign ? { ...q, status: "running" as const } : q,
      ),
    );

    try {
      const jobId = await launchCampaign(next.campaign, next.config);
      activeJobRef.current = jobId;
      setQueue((prev) =>
        prev.map((q) =>
          q.campaign === next.campaign ? { ...q, jobId, status: "running" as const } : q,
        ),
      );

      const source = new EventSource(`/api/jobs/${jobId}/stream`);
      source.addEventListener("done", (event) => {
        const payload = JSON.parse(event.data) as { status: string };
        source.close();
        activeJobRef.current = null;
        setQueue((prev) =>
          prev.map((q) =>
            q.jobId === jobId
              ? { ...q, status: payload.status === "completed" ? "done" : "failed" }
              : q,
          ),
        );
        setLaunching(false);
        toast.success(`${next.campaign} finished`, { description: payload.status });
      });
      source.onerror = () => {
        source.close();
        activeJobRef.current = null;
        setLaunching(false);
      };
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.campaign === next.campaign ? { ...q, status: "failed" as const } : q,
        ),
      );
      setLaunching(false);
      toast.error(err instanceof Error ? err.message : "Launch failed");
    }
  }, [launching, queue, launchCampaign]);

  useEffect(() => {
    if (queue.some((q) => q.status === "pending") && !activeJobRef.current) {
      void processQueue();
    }
  }, [queue, processQueue]);

  const enqueueCampaign = (campaignKey: string, config: CampaignConfigState) => {
    if (queue.some((q) => q.campaign === campaignKey && q.status !== "done")) {
      toast.error("Campaign already queued or running");
      return false;
    }
    setQueue((prev) => [...prev, { campaign: campaignKey, config, status: "pending" }]);
    toast.success("Queued", {
      description: `${campaignKey} · limit ${config.limit} · ${config.selectedMarkets.length} markets`,
    });
    return true;
  };

  const enqueueAllStates = () => {
    const toAdd: QueuedCampaign[] = [];
    for (const state of STATE_CAMPAIGNS) {
      const config = stateConfigs[state.key];
      if (!config) continue;
      if (queue.some((q) => q.campaign === state.key && q.status !== "done")) continue;
      toAdd.push({ campaign: state.key, config, status: "pending" });
    }
    if (toAdd.length === 0) {
      toast.error("All states already queued or running");
      return;
    }
    setQueue((prev) => [...prev, ...toAdd]);
    toast.success(`Queued ${toAdd.length} state campaigns`);
  };

  const selectedStateMeta = STATE_CAMPAIGNS.find((s) => s.key === selected);

  return (
    <div className="space-y-8">
      <section className="relative -mx-4 overflow-hidden md:-mx-8">
        <ASCIIAnimation
          frameFolder="planet"
          frameCount={200}
          quality="medium"
          fps={30}
          className="h-72 w-full md:h-96 [mask-image:radial-gradient(ellipse_70%_90%_at_50%_40%,black_55%,transparent_100%)]"
          gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
          lazy
          ariaLabel="Rotating earth"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-background/90 via-background/40 to-transparent p-6 md:p-10">
          <SectionHeading index="01" title="Campaign Control" className="mb-2" />
          <p className="max-w-xl font-mono text-xs tracking-[0.08em] text-muted-foreground">
            7 states · {marketsSelected} markets selected ·{" "}
            {estimate?.estimatedCredits != null
              ? `${formatCredits(estimate.estimatedCredits)} cr estimated`
              : "select a state to estimate"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline" className="pointer-events-auto font-mono text-[10px]">
              Firecrawl{" "}
              {credits?.firecrawl.remaining != null
                ? formatCredits(credits.firecrawl.remaining)
                : "—"}
            </Badge>
            <Badge variant="outline" className="pointer-events-auto font-mono text-[10px]">
              Gateway{" "}
              {credits?.aiGateway.balanceUsd != null
                ? formatUsd(credits.aiGateway.balanceUsd)
                : "—"}
            </Badge>
            {queue.length > 0 ? (
              <Badge variant="secondary" className="pointer-events-auto font-mono text-[10px]">
                {queue.filter((q) => q.status !== "done").length} queued
              </Badge>
            ) : null}
          </div>
        </div>
      </section>

      <SectionReveal>
        <Card className="glass sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
              Estimated burn — {selectedStateMeta?.label ?? selected}
            </CardTitle>
            <CardDescription>
              {selectedConfig
                ? `${selectedConfig.selectedMarkets.length} markets × ${selectedConfig.selectedCategories.length} categories × ${selectedConfig.limit} limit`
                : "Click a state card to configure"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <EstimateBreakdown estimate={estimate} />
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
        <SectionHeading index="02" title="State campaigns" className="mb-4" />
        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {STATE_CAMPAIGNS.map((state) => {
            const info = campaigns.find((c) => c.key === state.key);
            const config = stateConfigs[state.key];
            const queued = queue.find((q) => q.campaign === state.key);
            const cardEstimate = stateEstimates[state.key];

            return (
              <StaggerItem key={state.key}>
                <button
                  type="button"
                  onClick={() => openState(state.key)}
                  className={cn(
                    "hover-lift glass w-full cursor-pointer rounded-xl border p-4 text-left transition-colors",
                    selected === state.key && dialogOpen && "border-primary/50 ring-1 ring-primary/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-bold tracking-[0.15em]">
                      {state.label}
                    </span>
                    {queued ? (
                      <Badge variant="outline" className="font-mono text-[9px] uppercase">
                        {queued.status}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{state.name}</p>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    {info && config
                      ? `${config.selectedMarkets.length} markets · ${config.selectedCategories.length} categories · limit ${config.limit}`
                      : "…"}
                  </p>
                  {cardEstimate?.estimatedCredits != null ? (
                    <p className="mt-2 font-mono text-[10px] tabular-nums text-warning">
                      {formatCredits(cardEstimate.estimatedCredits)} cr
                      {cardEstimate.estimatedUsd != null
                        ? ` · ${formatUsd(cardEstimate.estimatedUsd)}`
                        : ""}
                    </p>
                  ) : null}
                </button>
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
          launching={launching}
          onChange={(patch) => updateStateConfig(selected, patch)}
          onLaunch={() => {
            if (selectedConfig) enqueueCampaign(selected, selectedConfig);
            setDialogOpen(false);
          }}
          onQueue={() => {
            if (selectedConfig) enqueueCampaign(selected, selectedConfig);
          }}
        />
      ) : null}

      <SectionReveal>
        <SectionHeading index="03" title="Launch controls" className="mb-4" />
        <Card className="glass">
          <CardContent className="space-y-5 py-6">
            <p className="font-mono text-xs text-muted-foreground">
              Click a state card to configure markets and limits, then launch or queue.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={enqueueAllStates} disabled={launching}>
                Queue all 7 states
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/runs">
                  <Play className="size-3.5" />
                  View runs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </SectionReveal>

      {queue.length > 0 ? (
        <SectionReveal>
          <SectionHeading index="04" title="Launch queue" className="mb-4" />
          <Card className="glass">
            <CardContent className="space-y-2 py-4">
              {queue.map((item) => (
                <div
                  key={item.campaign}
                  className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm"
                >
                  <span className="font-mono">{item.campaign}</span>
                  <span className="text-muted-foreground">
                    limit {item.config.limit}
                    {item.config.discoverOnly ? " · discover only" : ""}
                  </span>
                  <Badge variant="outline" className="font-mono text-[9px] uppercase">
                    {item.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </SectionReveal>
      ) : null}

      <SectionReveal>
        <Card className="glass border-dashed">
          <CardHeader>
            <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
              Multi-state population sequence
            </CardTitle>
            <CardDescription>
              Do not run all 7 states at once without a credit checkpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs leading-relaxed text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-4">
              <li>
                Fetch live credits on this page; set limit 20 and credit caps ≈ ⅛ remaining.
              </li>
              <li>
                Launch <strong className="text-foreground">hawaii</strong> first — smallest market
                count, cheapest quality check.
              </li>
              <li>Review run costs on the Costs page before continuing west.</li>
              <li>
                Continue sequentially: oregon → washington → california_expansion → nevada →
                arizona → new_mexico.
              </li>
            </ol>
          </CardContent>
        </Card>
      </SectionReveal>
    </div>
  );
}
