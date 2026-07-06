"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Play, Rocket } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { AnimatedNumber } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
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

type EstimateData = {
  estimatedCredits: number | null;
  estimatedUsd: number | null;
  avgCreditsPerLead: number | null;
  estimatedLeads: number;
};

type QueuedCampaign = {
  campaign: string;
  limit: number;
  status: "pending" | "running" | "done" | "failed";
  jobId?: string;
};

export function CampaignControl() {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [selected, setSelected] = useState<string>("hawaii");
  const [limit, setLimit] = useState(20);
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [queue, setQueue] = useState<QueuedCampaign[]>([]);
  const [launching, setLaunching] = useState(false);
  const activeJobRef = useRef<string | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.key === selected),
    [campaigns, selected],
  );

  const loadMeta = useCallback(async () => {
    const [campRes, credRes] = await Promise.all([
      fetch("/api/campaigns"),
      fetch("/api/credits"),
    ]);
    const campBody = (await campRes.json()) as { campaigns?: CampaignInfo[] };
    const credBody = (await credRes.json()) as CreditsData;
    setCampaigns(campBody.campaigns ?? []);
    setCredits(credBody);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!selectedCampaign) return;
    const params = new URLSearchParams({
      campaign: selected,
      markets: selectedCampaign.markets.map((m) => m.key).join(","),
      categories: selectedCampaign.categories.join(","),
      limit: String(limit),
    });
    void fetch(`/api/campaigns/estimate?${params}`)
      .then((r) => r.json())
      .then((body: EstimateData) => setEstimate(body));
  }, [selected, selectedCampaign, limit]);

  const budgetPct = useMemo(() => {
    if (!credits?.firecrawl.remaining || !estimate?.estimatedCredits) return 0;
    return Math.min(100, (estimate.estimatedCredits / credits.firecrawl.remaining) * 100);
  }, [credits, estimate]);

  const launchCampaign = useCallback(
    async (campaignKey: string, leadLimit: number) => {
      const remaining = credits?.firecrawl.remaining;
      const maxCreditsPerRun =
        remaining != null ? Math.max(50, Math.floor(remaining / 8)) : undefined;

      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runType: "run-campaign",
          campaign: campaignKey,
          limit: leadLimit,
          maxCreditsPerRun,
        }),
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
      const jobId = await launchCampaign(next.campaign, next.limit);
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

  const enqueueSelected = () => {
    if (queue.some((q) => q.campaign === selected && q.status !== "done")) {
      toast.error("Campaign already queued or running");
      return;
    }
    setQueue((prev) => [...prev, { campaign: selected, limit, status: "pending" }]);
    toast.success("Queued", { description: `${selected} · limit ${limit}` });
  };

  const enqueueAllStates = () => {
    const pending = STATE_CAMPAIGNS.filter(
      (s) => !queue.some((q) => q.campaign === s.key && q.status !== "done"),
    );
    setQueue((prev) => [
      ...prev,
      ...pending.map((s) => ({ campaign: s.key, limit, status: "pending" as const })),
    ]);
    toast.success(`Queued ${pending.length} state campaigns`);
  };

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6">
        <div className="absolute right-0 top-0 h-40 w-40 opacity-20">
          <ASCIIAnimation frameFolder="cube" frameCount={134} quality="medium" lazy />
        </div>
        <SectionHeading index="01" title="Campaign Control" className="mb-4" />
        <p className="max-w-xl font-mono text-xs tracking-[0.08em] text-muted-foreground">
          Credit-aware campaign launcher for HI → OR → WA → CA → NV → AZ → NM expansion.
        </p>
      </div>

      <SectionReveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="glass">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
                Firecrawl credits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">
                <AnimatedNumber value={credits?.firecrawl.remaining ?? 0} />
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {credits?.firecrawl.live ? "Live" : "Snapshot"}
                {credits?.firecrawl.plan
                  ? ` · plan ${formatCredits(credits.firecrawl.plan)}`
                  : ""}
              </p>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
                AI Gateway
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">
                {credits?.aiGateway.balanceUsd != null ? (
                  <AnimatedNumber value={credits.aiGateway.balanceUsd} format={formatUsd} />
                ) : (
                  "—"
                )}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {credits?.aiGateway.live ? "Live balance" : "Snapshot / unavailable"}
              </p>
            </CardContent>
          </Card>
          <Card className="glass sm:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
                Estimated burn
              </CardTitle>
              <CardDescription>
                {selectedCampaign
                  ? `${selectedCampaign.markets.length} markets × ${selectedCampaign.categories.length} categories × ${limit} limit`
                  : "Select a campaign"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-lg font-bold tabular-nums text-warning">
                  {estimate?.estimatedCredits != null ? (
                    <AnimatedNumber value={estimate.estimatedCredits} />
                  ) : (
                    "—"
                  )}{" "}
                  cr
                </span>
                {estimate?.estimatedUsd != null ? (
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    ~{formatUsd(estimate.estimatedUsd)}
                  </span>
                ) : null}
              </div>
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
        </div>
      </SectionReveal>

      <SectionReveal>
        <SectionHeading index="02" title="State campaigns" className="mb-4" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {STATE_CAMPAIGNS.map((state) => {
            const info = campaigns.find((c) => c.key === state.key);
            const active = selected === state.key;
            const queued = queue.find((q) => q.campaign === state.key);
            return (
              <button
                key={state.key}
                type="button"
                onClick={() => setSelected(state.key)}
                className={cn(
                  "glass rounded-xl border p-4 text-left transition-colors hover:border-primary/30",
                  active && "border-primary/50 ring-1 ring-primary/20",
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
                  {info ? `${info.markets.length} markets · ${info.categories.length} categories` : "…"}
                </p>
              </button>
            );
          })}
        </div>
      </SectionReveal>

      <SectionReveal>
        <SectionHeading index="03" title="Launch controls" className="mb-4" />
        <Card className="glass">
          <CardContent className="space-y-5 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  Lead limit per category
                </Label>
                <div className="flex items-center gap-3">
                  <Slider
                    min={5}
                    max={50}
                    step={5}
                    value={[limit]}
                    onValueChange={([v]) => setLimit(v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 20)}
                    className="w-20 font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={enqueueSelected} disabled={launching}>
                <Rocket className="size-4" />
                Launch {selected}
              </Button>
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
                  <span className="text-muted-foreground">limit {item.limit}</span>
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
                Fetch live credits on this page; set limit 20 and{" "}
                <code className="text-foreground">FIRECRAWL_MAX_CREDITS_PER_RUN</code> ≈ ⅛
                remaining (set automatically server-side when launching).
              </li>
              <li>
                Launch <strong className="text-foreground">hawaii</strong> first — smallest market
                count, cheapest quality check.
              </li>
              <li>
                After Hawaii completes: review{" "}
                <code className="text-foreground">pallares-leads db report &lt;run_id&gt;</code> and
                the Costs page for per-lead credit burn.
              </li>
              <li>
                Continue sequentially: oregon → washington → california_expansion → nevada →
                arizona → new_mexico. Adjust limit per state based on burn.
              </li>
              <li>
                CLI fallback:{" "}
                <code className="text-foreground">
                  pallares-leads run-campaign --campaign hawaii --limit 20 --no-sheets
                </code>
              </li>
            </ol>
          </CardContent>
        </Card>
      </SectionReveal>
    </div>
  );
}
