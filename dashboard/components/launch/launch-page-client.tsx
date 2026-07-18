"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, MessageSquareText, Rocket, Target } from "lucide-react";
import { toast } from "sonner";
import { CampaignControl } from "@/components/campaigns/campaign-control";
import { SectionHeading } from "@/components/console/section-heading";
import { JobTimeline } from "@/components/job-timeline";
import { RequestsPageClient } from "@/components/requests/requests-page-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import type { RequestCreditBudget } from "@/lib/request-budget";
import type { PipelineConfig, RequestRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LaunchMode = "campaign" | "request" | "single" | "smoke";

const MODES: {
  id: LaunchMode;
  label: string;
  description: string;
  icon: typeof Rocket;
}[] = [
  {
    id: "campaign",
    label: "Campaign",
    description: "Stage market × category matrices with estimates",
    icon: Rocket,
  },
  {
    id: "request",
    label: "Request",
    description: "Build a focused batch from a prompt or form",
    icon: MessageSquareText,
  },
  {
    id: "single",
    label: "Single",
    description: "One market × one category run",
    icon: Target,
  },
  {
    id: "smoke",
    label: "Smoke",
    description: "Cheap quality check before paid volume",
    icon: FlaskConical,
  },
];

function normalizeMode(value: string | null): LaunchMode {
  if (value === "request" || value === "single" || value === "smoke" || value === "campaign") {
    return value;
  }
  return "campaign";
}

function SingleRunPanel({ config }: { config: PipelineConfig }) {
  const [market, setMarket] = useState(config.markets[0]?.key ?? "");
  const [category, setCategory] = useState(config.categories[0]?.key ?? "");
  const [jobId, setJobId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    if (!market || !category) {
      toast.error("Select a market and category");
      return;
    }
    setLaunching(true);
    try {
      const res = await apiFetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runType: "run", market, category }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to start run");
      setJobId(data.jobId ?? null);
      toast.success("Single run started (local execution)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="panel">
        <CardHeader>
          <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
            Single market × category
          </CardTitle>
          <CardDescription>
            Spawns a local CLI job. Watch Run Control for the canonical persisted run after
            discovery starts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Market" />
              </SelectTrigger>
              <SelectContent>
                {config.markets.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.city}, {m.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {config.categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              Execution · local
            </Badge>
            <Button onClick={() => void launch()} disabled={launching || !market || !category}>
              {launching ? "Starting…" : "Launch single run"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {jobId ? <JobTimeline jobId={jobId} /> : null}
    </div>
  );
}

function SmokeRunPanel({ config }: { config: PipelineConfig }) {
  const [market, setMarket] = useState(config.markets[0]?.key ?? "reedley");
  const [jobId, setJobId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    setLaunching(true);
    try {
      const res = await apiFetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runType: "smoke-sample",
          market: market || undefined,
          limit: 5,
        }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to start smoke sample");
      setJobId(data.jobId ?? null);
      toast.success("Smoke sample started (local execution)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="panel">
        <CardHeader>
          <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
            Smoke sample
          </CardTitle>
          <CardDescription>
            Small fixed sample for quality proof before burning campaign credits. Local spawn only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-1.5">
            <Label>Anchor market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.markets.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.city}, {m.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              Execution · local
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              Limit 5
            </Badge>
            <Button onClick={() => void launch()} disabled={launching}>
              {launching ? "Starting…" : "Run smoke sample"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {jobId ? <JobTimeline jobId={jobId} /> : null}
    </div>
  );
}

export function LaunchPageClient({
  requests,
  config,
  requestBudget,
}: {
  requests: RequestRow[];
  config: PipelineConfig;
  requestBudget: RequestCreditBudget;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizeMode(searchParams.get("mode"));

  const setMode = useCallback(
    (next: LaunchMode) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("mode", next);
      router.replace(`/launch?${params.toString()}`);
    },
    [router, searchParams],
  );

  const rail = useMemo(
    () => (
      <Card className="panel">
        <CardHeader className="py-3 pb-2">
          <CardTitle className="font-mono text-[10px] uppercase tracking-[0.15em]">
            Preflight rail
          </CardTitle>
          <CardDescription className="text-xs">
            Dashboard jobs spawn the CLI locally on this machine. The pgmq{" "}
            <code className="font-mono">pipeline_jobs</code> worker is a separate execution path —
            not used by Launch here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pb-3 pt-0">
          <Badge variant="outline" className="font-mono text-[10px]">
            Execution · local
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            Live overlay · SSE while running
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            Canonical record · runs table
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            Caps · Settings / Firecrawl
          </Badge>
        </CardContent>
      </Card>
    ),
    [],
  );

  return (
    <div className="space-y-5" data-testid="launch-page">
      <div className="space-y-3">
        <SectionHeading index="01" title="Launch" />
        <p className="max-w-2xl font-mono text-xs tracking-[0.08em] text-muted-foreground">
          Configure → estimate → launch → observe. One operator noun: Run.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {MODES.map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                data-testid={`launch-mode-${item.id}`}
                className={cn(
                  "panel rounded-xl border p-3.5 text-left transition-colors",
                  active
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "hover:border-primary/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" />
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em]">
                    {item.label}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {rail}

      {mode === "campaign" ? <CampaignControl /> : null}
      {mode === "request" ? (
        <RequestsPageClient
          requests={requests}
          config={config}
          requestBudget={requestBudget}
        />
      ) : null}
      {mode === "single" ? <SingleRunPanel config={config} /> : null}
      {mode === "smoke" ? <SmokeRunPanel config={config} /> : null}
    </div>
  );
}
