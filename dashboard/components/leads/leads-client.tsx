"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Phone, Search, SlidersHorizontal } from "lucide-react";
import { SalesStatusBadge, ScoreBadge, VerificationBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import type { LeadRow, PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";

type LeadRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  onOpen: (placeId: string) => void;
};

const LeadTableRow = memo(function LeadTableRow({
  lead,
  categoryLabel,
  onOpen,
}: LeadRowProps) {
  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-accent/25"
      onClick={() => onOpen(lead.place_id)}
    >
      <TableCell>
        <p className="font-medium">{lead.business_name}</p>
        <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {lead.market_key ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{categoryLabel}</Badge>
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
  );
});

export function LeadsClient({
  initialLeads,
  config,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
}) {
  const searchParams = useSearchParams();
  const placeParam = searchParams.get("place");
  const [leads, setLeads] = useState(initialLeads);
  const [loading, setLoading] = useState(false);
  const [market, setMarket] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(null);
  const skipFilterFetch = useRef(true);
  const activeDetailId = detailId ?? placeParam;

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config],
  );

  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (market !== ALL) params.set("market", market);
    if (category !== ALL) params.set("category", category);
    if (status !== ALL) params.set("status", status);
    if (minScore > 0) params.set("minScore", String(minScore));
    params.set("limit", "1000");

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
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (lead) =>
        lead.business_name.toLowerCase().includes(q) ||
        (lead.city ?? "").toLowerCase().includes(q) ||
        (lead.phone ?? "").includes(q),
    );
  }, [leads, deferredSearch]);

  const openDetail = useCallback((placeId: string) => setDetailId(placeId), []);

  return (
    <div className="space-y-6">
      <PageHeader description="Enriched, callable leads ranked by score. Select rows to push to Google Sheets." />

      <Card className="glass sticky top-14 z-10">
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

      <Card className="glass min-w-0 !overflow-visible px-4 py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card">
              <TableRow className="hover:bg-transparent">
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                    Loading leads…
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                    No leads match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((lead) => (
                  <LeadTableRow
                    key={lead.place_id}
                    lead={lead}
                    categoryLabel={
                      categoryLabelMap.get(lead.category_key ?? "") ??
                      lead.category_key ??
                      "—"
                    }
                    onOpen={openDetail}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <LeadDetailModal placeId={activeDetailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
