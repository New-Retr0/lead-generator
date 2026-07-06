"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FlaskConical, Layers, Play, Rocket } from "lucide-react";
import { toast } from "sonner";
import { JobLogPanel } from "@/components/job-log-panel";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type { JobRecord, PipelineConfig, RunRow } from "@/lib/types";

type RunType = "run" | "run-campaign" | "smoke-sample";

const ALL = "__all__";

export function RunsPageClient({
  initialRuns,
  config,
}: {
  initialRuns: RunRow[];
  config: PipelineConfig;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [jobs, setJobs] = useState<JobRecord[]>([]);

  const [runType, setRunType] = useState<RunType>("run");
  const [market, setMarket] = useState("");
  const [category, setCategory] = useState("");
  const [allCategories, setAllCategories] = useState(false);
  const [limit, setLimit] = useState(5);
  const [discoverOnly, setDiscoverOnly] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const refreshRuns = () => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setJobs(data.jobs ?? []);
      });
  };

  useEffect(() => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs ?? []);
      });
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
      setJobId(data.jobId);
      toast.success("Run started", { description: "Streaming logs below." });
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

  const activeJob = jobs.find((j) => j.id === jobId);

  return (
    <div className="space-y-6">
      <PageHeader description="Launch single-pass runs — each place is discovered and enriched together — and watch progress in the timeline." />

      <JobLogPanel
        jobId={jobId}
        onDone={(status) => {
          refreshRuns();
          if (status === "completed") toast.success("Run finished");
          else if (status === "failed") toast.error("Run failed — check the log");
        }}
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="glass hover-lift">
          <CardHeader>
            <CardTitle>New run</CardTitle>
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
                <Label htmlFor="limit">Lead limit per category</Label>
                <Input
                  id="limit"
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
                {activeJob ? "Viewing selected job" : "Click to replay timeline"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${
                    jobId === job.id
                      ? "border-primary/50 bg-primary/10 shadow-[0_0_0_1px_oklch(0.55_0.18_262/0.25)]"
                      : "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-accent/30"
                  }`}
                  onClick={() => setJobId(job.id)}
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

      <Card className="glass min-w-0">
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Persisted runs from the lead database. Click a row for live progress and cost summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs in database yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-card/40 hover:bg-card/40">
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Market / Category</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Discovered</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Skipped</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Completed</TableHead>
                  <TableHead className="whitespace-nowrap">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.run_id}
                    className="cursor-pointer transition-colors hover:bg-accent/25"
                    onClick={() => router.push(`/runs/${encodeURIComponent(run.run_id)}`)}
                  >
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.run_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {run.market_key ?? "—"}
                      {run.category_key ? (
                        <span className="text-muted-foreground"> / {run.category_key}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.discovered_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {run.skipped_known_count}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {run.enriched_count}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {run.started_at.slice(0, 16).replace("T", " ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
