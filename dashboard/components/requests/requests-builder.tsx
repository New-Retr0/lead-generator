"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Building2,
  ChevronDown,
  Coins,
  MapPin,
  Route,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatedNumber } from "@/components/animated";
import { ChipSelect } from "@/components/chip-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  estimateRequestCost,
  type PipelineConfig,
  type RequestSpec,
} from "@/lib/types";

const DEFAULT_BUDGET = { max_firecrawl_credits: 200, max_usd: 10 };

export function RequestsBuilder({
  config,
  onJobStarted,
}: {
  config: PipelineConfig;
  onJobStarted: (jobId: string) => void;
}) {

  const [count, setCount] = useState(5);
  const [targetKind, setTargetKind] = useState<"property" | "vendor">("property");
  const [markets, setMarkets] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(40);
  const [requireDM, setRequireDM] = useState(true);
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [maxCredits, setMaxCredits] = useState(DEFAULT_BUDGET.max_firecrawl_credits);
  const [maxUsd, setMaxUsd] = useState(DEFAULT_BUDGET.max_usd);
  const [corridorOpen, setCorridorOpen] = useState(false);
  const [corridorRoad, setCorridorRoad] = useState("");
  const [corridorBuffer, setCorridorBuffer] = useState(800);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const spec: RequestSpec = useMemo(
    () => ({
      target_kind: targetKind,
      count,
      categories,
      market_keys: markets,
      corridor:
        corridorOpen && corridorRoad.trim()
          ? { road_ref: corridorRoad.trim(), buffer_m: corridorBuffer }
          : null,
      require_decision_maker: requireDM,
      recurring_only: recurringOnly,
      min_lead_score: minScore,
      budget: { max_firecrawl_credits: maxCredits, max_usd: maxUsd },
      needs_confirmation: [],
    }),
    [
      targetKind,
      count,
      categories,
      markets,
      corridorOpen,
      corridorRoad,
      corridorBuffer,
      requireDM,
      recurringOnly,
      minScore,
      maxCredits,
      maxUsd,
    ],
  );

  const estimate = useMemo(() => estimateRequestCost(spec), [spec]);
  const builderValid = markets.length > 0 && categories.length > 0 && count >= 1;

  const submit = async (body: Record<string, unknown>, dryRun: boolean) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start request");
        return;
      }
      onJobStarted(data.jobId);
      toast.success(dryRun ? "Estimating request…" : "Request started", {
        description: dryRun
          ? "Parsing and pricing only — no credits spent."
          : "Watch the job log for progress.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const marketOptions = config.markets.map((m) => ({
    value: m.key,
    label: m.city,
    hint: m.county ?? undefined,
  }));
  const categoryOptions = config.categories.map((c) => ({
    value: c.key,
    label: c.label,
    hint: c.recurring ? "Recurring-friendly" : undefined,
  }));

  return (
    <>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_300px]">
        <Tabs defaultValue="builder" className="min-w-0">
          <TabsList>
            <TabsTrigger value="builder">
              <Wand2 className="size-3.5" />
              Builder
            </TabsTrigger>
            <TabsTrigger value="nl">
              <Sparkles className="size-3.5" />
              Natural language
            </TabsTrigger>
          </TabsList>

          <TabsContent value="builder">
            <Card className="glass hover-lift">
              <CardHeader>
                <CardTitle>Build a request</CardTitle>
                <CardDescription>
                  Exact selectors — no LLM parsing, what you pick is what runs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="count">Number of leads</Label>
                    <Input
                      id="count"
                      type="number"
                      min={1}
                      max={500}
                      value={count}
                      onChange={(e) =>
                        setCount(
                          Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Target</Label>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={targetKind}
                      onValueChange={(v) =>
                        v && setTargetKind(v as "property" | "vendor")
                      }
                      className="w-full"
                    >
                      <ToggleGroupItem value="property" className="flex-1">
                        <Building2 className="size-3.5" />
                        Properties
                      </ToggleGroupItem>
                      <ToggleGroupItem value="vendor" className="flex-1">
                        Vendors
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-muted-foreground" />
                      Markets
                    </Label>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setMarkets(config.markets.map((m) => m.key))}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => setMarkets([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <ChipSelect
                    options={marketOptions}
                    selected={markets}
                    onChange={setMarkets}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Building2 className="size-3.5 text-muted-foreground" />
                      Property categories
                    </Label>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() =>
                          setCategories(config.categories.map((c) => c.key))
                        }
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => setCategories([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <ChipSelect
                    options={categoryOptions}
                    selected={categories}
                    onChange={setCategories}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="min-score">Minimum lead score</Label>
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
                      {minScore}
                    </span>
                  </div>
                  <Slider
                    id="min-score"
                    min={0}
                    max={100}
                    step={5}
                    value={[minScore]}
                    onValueChange={([v]) => setMinScore(v)}
                  />
                  <p className="text-xs text-muted-foreground">
                    70+ strong · 40–69 workable · below 40 lands in Triage
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                    <div>
                      <p className="text-sm font-medium">Decision-maker contact</p>
                      <p className="text-xs text-muted-foreground">
                        Owner, PM, or facilities contact required
                      </p>
                    </div>
                    <Switch checked={requireDM} onCheckedChange={setRequireDM} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                    <div>
                      <p className="text-sm font-medium">Recurring-only</p>
                      <p className="text-xs text-muted-foreground">
                        Properties suited to recurring programs
                      </p>
                    </div>
                    <Switch
                      checked={recurringOnly}
                      onCheckedChange={setRecurringOnly}
                    />
                  </label>
                </div>

                <Collapsible open={corridorOpen} onOpenChange={setCorridorOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 gap-1.5">
                      <Route className="size-3.5" />
                      Corridor filter
                      <ChevronDown
                        className={`size-3.5 transition-transform ${corridorOpen ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 grid gap-4 rounded-lg border bg-secondary/40 p-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="road">Road / highway</Label>
                        <Input
                          id="road"
                          placeholder="e.g. CA-99"
                          value={corridorRoad}
                          onChange={(e) => setCorridorRoad(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="buffer">Buffer (meters)</Label>
                        <Input
                          id="buffer"
                          type="number"
                          min={100}
                          step={100}
                          value={corridorBuffer}
                          onChange={(e) =>
                            setCorridorBuffer(Number(e.target.value) || 800)
                          }
                        />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="max-credits">Max Firecrawl credits</Label>
                    <Input
                      id="max-credits"
                      type="number"
                      min={1}
                      value={maxCredits}
                      onChange={(e) =>
                        setMaxCredits(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-usd">Max USD</Label>
                    <Input
                      id="max-usd"
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={maxUsd}
                      onChange={(e) =>
                        setMaxUsd(Math.max(0.5, Number(e.target.value) || 0.5))
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="lg"
                    disabled={!builderValid || submitting}
                    onClick={() => void submit({ spec }, false)}
                  >
                    <Sparkles className="size-4" />
                    Run request
                  </Button>
                  {!builderValid ? (
                    <p className="text-xs text-muted-foreground">
                      Pick at least one market and one category.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="nl">
            <Card className="glass hover-lift">
              <CardHeader>
                <CardTitle>Describe what you need</CardTitle>
                <CardDescription>
                  Parsed by the AI planner into a structured spec. Run a dry run
                  first to preview the parse and cost.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder='e.g. "10 strip malls and shopping centers in Fresno and Visalia along CA-99, decision-maker contacts only"'
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!prompt.trim() || submitting}
                    onClick={() => void submit({ prompt }, true)}
                  >
                    Parse &amp; estimate
                  </Button>
                  <Button
                    disabled={!prompt.trim() || submitting}
                    onClick={() => void submit({ prompt }, false)}
                  >
                    <Sparkles className="size-4" />
                    Run request
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tip: mention count, cities, property types, and optional
                  corridor (e.g. &quot;along CA-99&quot;).
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="glass glass-sheen border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Coins className="size-4 text-primary" />
                  Live cost estimate
                </CardTitle>
                <CardDescription>
                  Same formula the CLI uses before it runs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Total credits</span>
                  <span className="text-2xl font-bold tabular-nums">
                    <AnimatedNumber value={estimate.totalCredits} />
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Est. cost</span>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    <AnimatedNumber
                      value={estimate.usd}
                      format={(n) => `$${n.toFixed(2)}`}
                    />
                  </span>
                </div>
                <Separator />
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Places search ({markets.length || 0}×{categories.length || 0} combos)</span>
                    <span className="tabular-nums">{estimate.discoveryCredits} cr</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Per-place processing ({count} × 12)</span>
                    <span className="tabular-nums">{estimate.enrichCredits} cr</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Budget cap</span>
                    <span className="tabular-nums">
                      {maxCredits} cr / ${maxUsd.toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
