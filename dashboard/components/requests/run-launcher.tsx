"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Layers, Play, Rocket } from "lucide-react";
import { toast } from "sonner";
import { RunStatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type { JobRecord, PipelineConfig } from "@/lib/types";

type RunType = "run" | "run-campaign" | "smoke-sample";

const ALL = "__all__";

export function RunLauncher({
  config,
  onJobStarted,
}: {
  config: PipelineConfig;
  onJobStarted: (jobId: string) => void;
}) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const [runType, setRunType] = useState<RunType>("run");
  const [market, setMarket] = useState("");
  const [category, setCategory] = useState("");
  const [allCategories, setAllCategories] = useState(false);
  const [limit, setLimit] = useState(5);
  const [discoverOnly, setDiscoverOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshRuns = () => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs ?? []);
      });
  };

  useEffect(() => {
    refreshRuns();
  }, []);

  const marketValue = market || config.markets[0]?.key || "";
  const categoryValue = category || config.categories[0]?.key || "";

  const startRun = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        runType,
        limit: limit || undefined,
        discoverOnly,
      };
      if (runType === "run") {
        body.market = marketValue;
        if (allCategories) body.allCategories = true;
        else body.category = categoryValue;
      } else {
        body.campaign = config.campaigns[0]?.key ?? "central_valley";
        if (marketValue && marketValue !== ALL) body.market = marketValue;
        if (runType === "run-campaign" && categoryValue && categoryValue !== ALL) {
          body.category = categoryValue;
        }
      }
      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start run");
        return;
      }
      setActiveJobId(data.jobId);
      onJobStarted(data.jobId);
      toast.success("Run started", { description: "Streaming logs above." });
      setTimeout(refreshRuns, 2000);
    } finally {
      setLoading(false);
    }
  };

  const validRun =
    runType !== "run" || (marketValue && (allCategories || categoryValue));

  const runTypeMeta: Record<RunType, { icon: typeof Play; blurb: string }> = {
    run: { icon: Play, blurb: "One market, one category (or all)." },
    "run-campaign": {
      icon: Layers,
      blurb: "Full campaign matrix with optional filters.",
    },
    "smoke-sample": {
      icon: FlaskConical,
      blurb: "Small test sample — discover and enrich each place in one pass.",
    },
  };

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="glass hover-lift">
        <CardHeader>
          <CardTitle>Pipeline run</CardTitle>
          <CardDescription>{runTypeMeta[runType].blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleGroup
            type="single"
            variant="outline"
            value={runType}
            onValueChange={(v) => v && setRunType(v as RunType)}
            className="w-full"
          >
            <ToggleGroupItem value="run" className="flex-1">
              <Play className="size-3.5" />
              Single run
            </ToggleGroupItem>
            <ToggleGroupItem value="run-campaign" className="flex-1">
              <Layers className="size-3.5" />
              Campaign
            </ToggleGroupItem>
            <ToggleGroupItem value="smoke-sample" className="flex-1">
              <FlaskConical className="size-3.5" />
              Smoke sample
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Market</Label>
              <Select value={marketValue} onValueChange={setMarket}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  {runType !== "run" ? (
                    <SelectItem value={ALL}>All campaign markets</SelectItem>
                  ) : null}
                  {config.markets.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.city}
                      <span className="text-muted-foreground"> · {m.key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {runType !== "smoke-sample" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Category</Label>
                  {runType === "run" ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={allCategories}
                        onCheckedChange={setAllCategories}
                      />
                      All categories
                    </label>
                  ) : null}
                </div>
                <Select
                  value={categoryValue}
                  onValueChange={setCategory}
                  disabled={runType === "run" && allCategories}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {runType === "run-campaign" ? (
                      <SelectItem value={ALL}>All categories</SelectItem>
                    ) : null}
                    {config.categories.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="run-launcher-limit">Lead limit per category</Label>
              <Input
                id="run-launcher-limit"
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setRunType("run");
                setLimit(5);
                setDiscoverOnly(false);
              }}
            >
              <FlaskConical className="size-3.5" />
              Smoke preset (5 leads)
            </Button>
            <label className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-sm">
              <Switch checked={discoverOnly} onCheckedChange={setDiscoverOnly} />
              Discovery only (free)
            </label>
          </div>

          <Button size="lg" onClick={() => void startRun()} disabled={loading || !validRun}>
            <Rocket className="size-4" />
            Launch run
          </Button>
        </CardContent>
      </Card>

      {jobs.length > 0 ? (
        <Card className="glass min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Session jobs</CardTitle>
            <CardDescription>
              {activeJobId ? "Viewing selected job" : "Click to replay timeline"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${
                  activeJobId === job.id
                    ? "border-primary/50 bg-primary/10 shadow-[0_0_0_1px_oklch(0.55_0.18_262/0.25)]"
                    : "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-accent/30"
                }`}
                onClick={() => {
                  setActiveJobId(job.id);
                  onJobStarted(job.id);
                }}
              >
                <RunStatusBadge status={job.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {job.args.join(" ")}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
