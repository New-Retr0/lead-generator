"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Phone, Search, SlidersHorizontal, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { SalesStatusBadge, ScoreBadge, VerificationBadge } from "@/components/badges";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePipelineConfig } from "@/hooks/use-pipeline-config";
import type { LeadRow } from "@/lib/types";

const ALL = "__all__";

function LeadsPageContent() {
  const searchParams = useSearchParams();
  const { config, loaded } = usePipelineConfig();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [market, setMarket] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const place = searchParams.get("place");
    if (place) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link ?place= opens sheet
      setDetailId(place);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    // Refetch spinner when filters change (not a sync external-store subscription).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional refetch UX
    setLoading(true);

    const params = new URLSearchParams();
    if (market !== ALL) params.set("market", market);
    if (category !== ALL) params.set("category", category);
    if (status !== ALL) params.set("status", status);
    if (minScore > 0) params.set("minScore", String(minScore));

    const run = async () => {
      try {
        const res = await fetch(`/api/leads?${params.toString()}`);
        const data = (await res.json()) as { leads?: LeadRow[] };
        if (!cancelled) setLeads(data.leads ?? []);
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [market, category, status, minScore]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (lead) =>
        lead.business_name.toLowerCase().includes(q) ||
        (lead.city ?? "").toLowerCase().includes(q) ||
        (lead.phone ?? "").includes(q),
    );
  }, [leads, search]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((l) => selected.has(l.place_id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visible.forEach((l) => next.delete(l.place_id));
      } else {
        visible.forEach((l) => next.add(l.place_id));
      }
      return next;
    });
  };

  const toggleOne = (placeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  const exportSelected = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/export/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Export failed to start");
        return;
      }
      toast.success(`Exporting ${selected.size} lead(s) to Google Sheets`, {
        description: "Formatting is applied automatically on export.",
      });
      setSelected(new Set());
    } finally {
      setExporting(false);
    }
  };

  const categoryLabel = (key: string | null) =>
    config.categories.find((c) => c.key === key)?.label ?? key ?? "—";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Enriched, callable leads ranked by score. Select rows to push to Google Sheets.
      </p>

      <Card className="glass">
        <CardContent className="flex flex-wrap items-end gap-4 py-5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search business, city, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All markets</SelectItem>
                {config.markets.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {config.categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="Ready to call">Ready to call</SelectItem>
                <SelectItem value="Needs research">Needs research</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-44 space-y-1.5">
            <Label className="flex items-center gap-1 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-3" />
              Min score: <span className="font-semibold tabular-nums">{minScore}</span>
            </Label>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[minScore]}
              onValueChange={([v]) => setMinScore(v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass !overflow-visible px-4 py-0">
        <Table>
          <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Market</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loaded || loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  Loading leads…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  No leads match these filters. Launch a run or relax the filters.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((lead) => (
                <TableRow
                  key={lead.place_id}
                  className="cursor-pointer transition-colors hover:bg-accent/25"
                  onClick={() => setDetailId(lead.place_id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(lead.place_id)}
                      onCheckedChange={() => toggleOne(lead.place_id)}
                      aria-label={`Select ${lead.business_name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{lead.business_name}</p>
                    <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lead.market_key ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{categoryLabel(lead.category_key)}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <ScoreBadge score={lead.lead_score} />
                  </TableCell>
                  <TableCell>
                    <VerificationBadge level={lead.verification_level} />
                  </TableCell>
                  <TableCell>
                    <SalesStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
                        <Phone className="size-3 text-muted-foreground" />
                        {lead.phone}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className="glass-strong fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit items-center gap-3 rounded-full px-4 py-2.5 shadow-xl"
          >
            <span className="text-sm font-medium tabular-nums">
              {selected.size} selected
            </span>
            <Button size="sm" onClick={exportSelected} disabled={exporting}>
              <UploadCloud className="size-4" />
              Export to Sheets
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
            >
              <X className="size-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Loading leads…
        </div>
      }
    >
      <LeadsPageContent />
    </Suspense>
  );
}
