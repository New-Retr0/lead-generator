"use client";

import { Rocket } from "lucide-react";
import { ChipSelect } from "@/components/chip-select";
import {
  EstimateBreakdown,
  type EstimateBreakdownData,
} from "@/components/campaigns/estimate-breakdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Market = { key: string; city: string; state: string };

export type CampaignConfigState = {
  selectedMarkets: string[];
  selectedCategories: string[];
  limit: number;
  discoverOnly: boolean;
  maxCreditsPerRun: number | "";
};

type CampaignConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stateKey: string;
  stateLabel: string;
  stateName: string;
  markets: Market[];
  categories: string[];
  config: CampaignConfigState;
  estimate: EstimateBreakdownData | null;
  launching: boolean;
  onChange: (patch: Partial<CampaignConfigState>) => void;
  onLaunch: () => void;
  onQueue: () => void;
};

export function CampaignConfigDialog({
  open,
  onOpenChange,
  stateKey,
  stateLabel,
  stateName,
  markets,
  categories,
  config,
  estimate,
  launching,
  onChange,
  onLaunch,
  onQueue,
}: CampaignConfigDialogProps) {
  const allSelected = config.selectedMarkets.length === markets.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {stateLabel} — {stateName}
          </DialogTitle>
          <DialogDescription>
            Configure markets, categories, and limits for {stateKey}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Markets</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => onChange({ selectedMarkets: markets.map((m) => m.key) })}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:underline"
                  onClick={() => onChange({ selectedMarkets: [] })}
                >
                  None
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/40 p-2">
              {markets.map((market) => (
                <label
                  key={market.key}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={config.selectedMarkets.includes(market.key)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...config.selectedMarkets, market.key]
                        : config.selectedMarkets.filter((k) => k !== market.key);
                      onChange({ selectedMarkets: next });
                    }}
                    className="size-3.5 rounded border-border accent-primary"
                  />
                  <span>
                    {market.city}, {market.state}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{market.key}</span>
                </label>
              ))}
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              {config.selectedMarkets.length} of {markets.length} selected
              {allSelected ? " (all)" : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Categories</Label>
            <ChipSelect
              options={categories.map((cat) => ({
                value: cat,
                label: cat.replace(/_/g, " "),
              }))}
              selected={config.selectedCategories}
              onChange={(selectedCategories) => onChange({ selectedCategories })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Lead limit</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={config.limit}
                onChange={(e) =>
                  onChange({ limit: Math.max(1, Number(e.target.value) || 20) })
                }
                className="font-mono tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">
                Max credits / run
              </Label>
              <Input
                type="number"
                min={1}
                placeholder="auto"
                value={config.maxCreditsPerRun}
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange({
                    maxCreditsPerRun:
                      raw === "" ? "" : Math.max(1, Math.floor(Number(raw) || 0)),
                  });
                }}
                className="font-mono tabular-nums"
              />
            </div>
            <div className="flex flex-col justify-end gap-2 rounded-lg border border-border/40 px-3 py-2">
              <Label htmlFor="discover-only" className="text-xs">
                Discovery only
              </Label>
              <Switch
                id="discover-only"
                checked={config.discoverOnly}
                onCheckedChange={(discoverOnly) => onChange({ discoverOnly })}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 md:col-span-2">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Estimate
            </p>
            <EstimateBreakdown estimate={estimate} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={launching} onClick={onQueue}>
            Add to queue
          </Button>
          <Button disabled={launching} onClick={onLaunch}>
            <Rocket className="size-3.5" />
            Launch {stateLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
