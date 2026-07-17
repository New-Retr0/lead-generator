"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Phone, Search, ShieldAlert } from "lucide-react";
import {
  SalesStatusBadge,
  VerificationBadge,
} from "@/components/badges";
import { SectionHeading } from "@/components/console/section-heading";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeadRow, PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";

function triageReason(lead: LeadRow): string {
  if (lead.verification_level === "unverified") return "Unverified contact";
  if (lead.enrichment_status === "needs_manual") return "Needs manual review";
  if (lead.confidence === "Low") return "Low confidence";
  return "Needs attention";
}

function isTriageLead(lead: LeadRow): boolean {
  return (
    lead.verification_level === "unverified" ||
    lead.enrichment_status === "needs_manual" ||
    lead.confidence === "Low" ||
    lead.enrichment_status === "unverified"
  );
}

type DataRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  tab: string;
  onOpen: (placeId: string) => void;
};

const DataTableRow = memo(function DataTableRow({
  lead,
  categoryLabel,
  tab,
  onOpen,
}: DataRowProps) {
  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-accent/25"
      onClick={() => onOpen(lead.place_id)}
    >
      <TableCell>
        <p className="font-medium">{lead.business_name}</p>
        <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
      </TableCell>
      <TableCell>
        <Badge variant={lead.lead_type === "vendor" ? "secondary" : "outline"}>
          {lead.lead_type === "vendor" ? "Vendor" : "Client"}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {lead.market_key ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{categoryLabel}</Badge>
      </TableCell>
      <TableCell>
        <VerificationBadge level={lead.verification_level} />
      </TableCell>
      {tab === "triage" ? (
        <TableCell>
          <Badge variant="outline">{triageReason(lead)}</Badge>
        </TableCell>
      ) : (
        <TableCell>
          <SalesStatusBadge status={lead.status} />
        </TableCell>
      )}
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

export function DataExplorer({
  initialLeads,
  config,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
}) {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "triage"
    ? "triage"
    : searchParams.get("tab") === "vendors"
      ? "vendors"
      : "all";

  const [leads, setLeads] = useState(initialLeads);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"all" | "triage" | "vendors">(initialTab);
  const [market, setMarket] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [verification, setVerification] = useState(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(null);
  const skipFilterFetch = useRef(true);

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
    if (tab === "vendors") params.set("type", "vendor");
    if (tab === "triage") params.set("dudsOnly", "1");
    if (market !== ALL) params.set("market", market);
    if (category !== ALL) params.set("category", category);
    if (status !== ALL) params.set("status", status);
    params.set("limit", "1000");

    void fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { leads?: LeadRow[] }) => {
        if (!cancelled) setLeads(data.leads ?? []);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, market, category, status]);

  const visible = useMemo(() => {
    let rows = leads;
    if (tab === "triage") rows = rows.filter(isTriageLead);
    if (tab === "vendors") rows = rows.filter((l) => l.lead_type === "vendor");
    if (verification !== ALL) {
      rows = rows.filter((l) => (l.verification_level ?? "unverified") === verification);
    }
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (l) =>
        l.business_name.toLowerCase().includes(q) ||
        (l.city ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").includes(q),
    );
  }, [leads, tab, verification, deferredSearch]);

  const openDetail = useCallback((placeId: string) => setDetailId(placeId), []);

  return (
    <div className="space-y-6">
      <SectionHeading index="01" title="Lead Data Explorer" />
      <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
        Unified pipeline data — filter by market, category, verification, and status.
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="font-mono text-[10px] uppercase tracking-[0.12em]">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="triage">Triage</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="glass sticky top-14 z-10">
        <CardContent className="flex flex-wrap items-end gap-4 py-5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 font-mono text-sm"
              placeholder="Search business, city, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Market
            </Label>
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
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Category
            </Label>
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
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Status
            </Label>
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

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Verification
            </Label>
            <Select value={verification} onValueChange={setVerification}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All levels</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="unverified">Unverified</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </CardContent>
      </Card>

      <Card className="glass min-w-0 !overflow-visible px-4 py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card [&_th]:font-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-[0.12em]">
              <TableRow className="hover:bg-transparent">
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>{tab === "triage" ? "Why" : "Status"}</TableHead>
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
                  <TableCell colSpan={7} className="h-32 text-center">
                    <ShieldAlert className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No leads match these filters.</p>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((lead) => (
                  <DataTableRow
                    key={lead.place_id}
                    lead={lead}
                    tab={tab}
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

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
