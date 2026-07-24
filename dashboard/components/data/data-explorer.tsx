"use client";

import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Phone, Search, ShieldAlert, User } from "lucide-react";
import {
  SalesStatusBadge,
  ScoreBadge,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";
import {
  inventoryModeLabel,
  parseInventoryMode as parseInventoryModeShared,
} from "@/lib/lead-labels";
import type { InventoryMode, LeadRow, PipelineConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";
const TABLE_MIN_ROWS = 8;

type DataTab = "all" | "vendors";

type DataRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  onOpen: (placeId: string) => void;
};

const DataTableRow = memo(function DataTableRow({
  lead,
  categoryLabel,
  onOpen,
}: DataRowProps) {
  return (
    <TableRow
      className="cursor-pointer transition-colors [content-visibility:auto] [contain-intrinsic-size:48px] hover:bg-accent"
      onClick={() => onOpen(lead.place_id)}
    >
      <TableCell>
        <p className="font-medium">{lead.business_name}</p>
        <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
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
      <TableCell>
        {lead.best_contact_name ? (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              <User className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{lead.best_contact_name}</span>
            </p>
            {lead.best_contact_role ? (
              <p className="truncate text-xs text-muted-foreground">{lead.best_contact_role}</p>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <VerificationBadge level={lead.verification_level} />
      </TableCell>
      <TableCell className="text-center">
        <ScoreBadge score={lead.lead_score} />
      </TableCell>
      <TableCell>
        <SalesStatusBadge status={lead.status} />
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
    </TableRow>
  );
});

function TableShellRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TableRow key={`shell-${i}`} className="hover:bg-transparent">
          <TableCell colSpan={9} className="h-12 p-0">
            <span className="sr-only">Reserved row</span>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function parseInventoryMode(raw: string | null): InventoryMode {
  return parseInventoryModeShared(raw);
}

function parseDataTab(raw: string | null): DataTab {
  return raw === "vendors" ? "vendors" : "all";
}

function parseMarketKey(raw: string | null, markets: PipelineConfig["markets"]): string {
  if (!raw || raw === ALL) return ALL;
  return markets.some((m) => m.key === raw) ? raw : ALL;
}

export function DataExplorer({
  initialLeads,
  config,
  initialInventoryMode = "verified",
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
  initialInventoryMode?: InventoryMode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = parseDataTab(searchParams.get("tab"));
  const urlInventory = parseInventoryMode(searchParams.get("inventory"));
  const urlMarket = parseMarketKey(searchParams.get("market"), config.markets);
  const urlPlace = searchParams.get("place");

  /** Server-filtered inventory; vendors/search/verification refine client-side. */
  const [leads, setLeads] = useState(initialLeads);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<DataTab>(urlTab);
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>(
    urlInventory || initialInventoryMode,
  );
  const [market, setMarket] = useState(urlMarket);
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [verification, setVerification] = useState(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(urlPlace);
  const skipFilterFetch = useRef(true);
  const requestId = useRef(0);
  /** Tracks whether `leads` was fetched with type=vendor so All never shows a vendor-only cache. */
  const fetchedScope = useRef<"all" | "vendor">(
    urlTab === "vendors" ? "vendor" : "all",
  );

  /** Status/verification are implied by Verified/Unverified inventory — keep selects out. */
  const showQualityFilters = inventoryMode === "all";

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config],
  );

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onTabChange = useCallback(
    (next: string) => {
      const value: DataTab = next === "vendors" ? "vendors" : "all";
      startTransition(() => setTab(value));
      replaceParams((params) => {
        if (value === "vendors") params.set("tab", "vendors");
        else params.delete("tab");
      });
    },
    [replaceParams],
  );

  const onInventoryChange = useCallback(
    (mode: InventoryMode) => {
      startTransition(() => {
        setInventoryMode(mode);
        // Verified/Unverified already encode readiness — clear dead client filters.
        if (mode !== "all") {
          setStatus(ALL);
          setVerification(ALL);
        }
      });
      replaceParams((params) => {
        if (mode === "verified") params.delete("inventory");
        else params.set("inventory", mode);
      });
    },
    [replaceParams],
  );

  const onMarketChange = useCallback(
    (value: string) => {
      startTransition(() => setMarket(value));
      replaceParams((params) => {
        if (value === ALL) params.delete("market");
        else params.set("market", value);
      });
    },
    [replaceParams],
  );

  // Soft-nav / back-forward: keep client filters aligned with the URL.
  useEffect(() => {
    startTransition(() => {
      setTab(urlTab);
      setInventoryMode(urlInventory);
      setMarket(urlMarket);
      setDetailId(urlPlace);
      if (urlInventory !== "all") {
        setStatus(ALL);
        setVerification(ALL);
      }
    });
  }, [urlTab, urlInventory, urlMarket, urlPlace]);

  // Refetch for server-side filters including Vendors (type applied before LIMIT).
  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    const id = ++requestId.current;
    const wantScope: "all" | "vendor" = tab === "vendors" ? "vendor" : "all";
    let cancelled = false;
    setRefreshing(true);
    // Drop cross-scope cache immediately so All never flashes vendor-only rows.
    if (fetchedScope.current !== wantScope) {
      startTransition(() => setLeads([]));
    }
    const params = new URLSearchParams();
    if (wantScope === "vendor") params.set("type", "vendor");
    if (market !== ALL) params.set("market", market);
    if (category !== ALL) params.set("category", category);
    if (showQualityFilters && status !== ALL) params.set("status", status);
    params.set("inventory", inventoryMode);
    params.set("limit", "1000");

    void apiFetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { leads?: LeadRow[] }) => {
        if (!cancelled && id === requestId.current) {
          fetchedScope.current = wantScope;
          startTransition(() => setLeads(data.leads ?? []));
        }
      })
      .catch(() => {
        if (!cancelled && id === requestId.current) {
          fetchedScope.current = wantScope;
          startTransition(() => setLeads([]));
        }
      })
      .finally(() => {
        if (!cancelled && id === requestId.current) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, market, category, status, inventoryMode, showQualityFilters]);

  const visible = useMemo(() => {
    let rows = leads;
    // Server already scopes type=vendor; keep client filter as a safety net.
    if (tab === "vendors") rows = rows.filter((l) => l.lead_type === "vendor");
    if (showQualityFilters && verification !== ALL) {
      rows = rows.filter((l) => (l.verification_level ?? "unverified") === verification);
    }
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (l) =>
        l.business_name.toLowerCase().includes(q) ||
        (l.city ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").includes(q) ||
        (l.best_contact_name ?? "").toLowerCase().includes(q),
    );
  }, [leads, tab, verification, deferredSearch, showQualityFilters]);

  const openDetail = useCallback(
    (placeId: string) => {
      setDetailId(placeId);
      replaceParams((params) => {
        params.set("place", placeId);
      });
    },
    [replaceParams],
  );

  const closeDetail = useCallback(() => {
    setDetailId(null);
    replaceParams((params) => {
      params.delete("place");
    });
  }, [replaceParams]);

  const shellCount = Math.max(0, TABLE_MIN_ROWS - Math.max(visible.length, 1));

  return (
    <div className="space-y-6">
      <SectionHeading index="01" title="Lead Data Explorer" />
      <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
        Default view is Verified leads. Unverified and All leads are opt-in — unverified can
        still be tried. Researched misses stay hidden (skip_known).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList className="font-mono text-[10px] uppercase tracking-[0.12em]">
            <TabsTrigger value="all" className="min-w-[4.5rem]">
              All
            </TabsTrigger>
            <TabsTrigger value="vendors" className="min-w-[4.5rem]">
              Vendors
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-1.5">
          {(
            ["verified", "unverified", "all", "dud"] as const
          ).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onInventoryChange(mode)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                inventoryMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {inventoryModeLabel(mode)}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
          {visible.length} shown
          {refreshing ? " · updating…" : ""}
        </span>
      </div>

      <Card className="panel sticky top-14 z-10 bg-card">
        <CardContent className="flex flex-wrap items-end gap-4 py-5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 font-mono text-sm"
              placeholder="Search business, DM, city, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Market
            </Label>
            <Select value={market} onValueChange={onMarketChange}>
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

          {showQualityFilters ? (
            <>
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
                    <SelectItem value="Verified">Verified</SelectItem>
                    <SelectItem value="Unverified">Unverified</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Level
                </Label>
                <Select value={verification} onValueChange={setVerification}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All levels</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="partial">Unverified (phone)</SelectItem>
                    <SelectItem value="unverified">Unverified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="panel min-w-0 !overflow-visible px-4 py-0">
        <div
          className={cn(
            "min-h-[28rem] overflow-x-auto transition-opacity duration-150",
            refreshing && "opacity-70",
          )}
        >
          <Table>
            <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card [&_th]:font-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-[0.12em]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[10rem]">Business</TableHead>
                <TableHead className="min-w-[8rem]">Phone</TableHead>
                <TableHead className="min-w-[10rem]">Decision maker</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="w-16 text-center">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Type</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="h-40 text-center">
                    <ShieldAlert className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      {refreshing ? "Updating inventory…" : "No leads match these filters."}
                    </p>
                    {refreshing ? (
                      <div className="mx-auto mt-4 max-w-sm space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-[80%]" />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((lead) => (
                  <DataTableRow
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
              {shellCount > 0 ? <TableShellRows count={shellCount} /> : null}
            </TableBody>
          </Table>
        </div>
      </Card>

      <LeadDetailModal placeId={detailId} onClose={closeDetail} />
    </div>
  );
}
