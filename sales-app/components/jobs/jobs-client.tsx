"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Send, Stethoscope } from "lucide-react";
import { toast } from "sonner";
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
import type { PipelineConfig, PipelineJob, PipelineJobKind } from "@/lib/types";

function statusVariant(status: PipelineJob["status"]) {
  if (status === "succeeded") return "success";
  if (status === "running" || status === "queued") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  return "secondary";
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function fetchJobs(): Promise<PipelineJob[]> {
  const res = await fetch("/api/jobs?limit=25", { cache: "no-store" });
  const body = (await res.json()) as { jobs?: PipelineJob[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Failed to load jobs");
  return body.jobs ?? [];
}

async function enqueue(kind: PipelineJobKind, payload: Record<string, unknown>) {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Failed to enqueue job");
  return body.id;
}

export function JobsClient({
  initialJobs,
  config,
}: {
  initialJobs: PipelineJob[];
  config: PipelineConfig;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<PipelineJobKind>("doctor");
  const [market, setMarket] = useState(config.markets[0]?.key ?? "");
  const [category, setCategory] = useState(config.categories[0]?.key ?? "");
  const [campaign, setCampaign] = useState(config.campaigns[0]?.key ?? "central_valley");
  const [limit, setLimit] = useState("");
  const [prompt, setPrompt] = useState("");
  const [discoverOnly, setDiscoverOnly] = useState(false);
  const [skipSheets, setSkipSheets] = useState(true);

  const selectedCampaign = useMemo(
    () => config.campaigns.find((item) => item.key === campaign),
    [campaign, config.campaigns],
  );

  async function refresh() {
    setLoading(true);
    try {
      setJobs(await fetchJobs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh jobs");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setLoading(true);
    try {
      const numericLimit = limit.trim() ? Number(limit) : undefined;
      const payload: Record<string, unknown> = {};
      if (kind === "run") {
        payload.market = market;
        payload.category = category;
        if (numericLimit) payload.limit = numericLimit;
        payload.discover_only = discoverOnly;
        payload.no_sheets = skipSheets;
      } else if (kind === "run_campaign") {
        payload.campaign = campaign;
        if (numericLimit) payload.limit = numericLimit;
        payload.discover_only = discoverOnly;
        payload.no_sheets = skipSheets;
      } else if (kind === "request") {
        if (!prompt.trim()) throw new Error("Enter a lead request prompt.");
        payload.prompt = prompt.trim();
        payload.yes = true;
      }

      await enqueue(kind, payload);
      toast.success("Job queued");
      setJobs(await fetchJobs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue job");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,420px)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Enqueue command</CardTitle>
          <CardDescription>Jobs wait in Supabase until the Python worker picks them up.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Command</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as PipelineJobKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="doctor">Doctor</SelectItem>
                <SelectItem value="run">Market/category run</SelectItem>
                <SelectItem value="run_campaign">Campaign run</SelectItem>
                <SelectItem value="request">Lead request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "run" ? (
            <>
              <div className="space-y-2">
                <Label>Market</Label>
                <Select value={market} onValueChange={setMarket}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.markets.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.categories.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {kind === "run_campaign" ? (
            <div className="space-y-2">
              <Label>Campaign</Label>
              <Select value={campaign} onValueChange={setCampaign}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.campaigns.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCampaign ? (
                <p className="text-xs text-muted-foreground">
                  {selectedCampaign.markets.length} markets, {selectedCampaign.categories.length} categories
                </p>
              ) : null}
            </div>
          ) : null}

          {kind === "request" ? (
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="5 callable property manager leads in Reedley"
              />
            </div>
          ) : null}

          {kind === "run" || kind === "run_campaign" ? (
            <>
              <div className="space-y-2">
                <Label>Limit</Label>
                <Input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label htmlFor="discover-only">Discover only</Label>
                <Switch id="discover-only" checked={discoverOnly} onCheckedChange={setDiscoverOnly} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label htmlFor="skip-sheets">Skip Sheets export</Label>
                <Switch id="skip-sheets" checked={skipSheets} onCheckedChange={setSkipSheets} />
              </div>
            </>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" onClick={submit} disabled={loading} className="flex-1">
              {kind === "doctor" ? <Stethoscope className="size-4" /> : <Send className="size-4" />}
              Queue
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={loading}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent jobs</CardTitle>
          <CardDescription>Queue state from Supabase.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No queued jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Kind</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Attempts</th>
                    <th className="py-2 pr-3">Command</th>
                    <th className="py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50">
                      <td className="py-2 pr-3">
                        <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-medium">{job.kind}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{fmtDate(job.created_at)}</td>
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                        {job.attempts}/{job.max_attempts}
                      </td>
                      <td className="max-w-[260px] truncate py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {job.command ?? "-"}
                      </td>
                      <td className="max-w-[260px] truncate py-2 text-xs text-destructive">
                        {job.error ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
