"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BarChart3,
  ChevronDown,
  Coins,
  DollarSign,
  ExternalLink,
  Globe,
  Lightbulb,
  Link2,
  MapPin,
  MessageCircle,
  Phone,
  User,
} from "lucide-react";
import {
  SalesStatusBadge,
  ScoreBadge,
  VerificationBadge,
} from "@/components/badges";
import { SocialIcon, socialPlatformLabel } from "@/components/social-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupLeadContacts,
  normalizePhoneKey,
  primaryLabel,
  sourceDomain,
  type ContactSource,
  type EmailGroup,
  type PhoneGroup,
} from "@/lib/lead-contacts";
import { cn, formatCostUnits, formatProvider, formatUsd } from "@/lib/utils";
import type { LeadCostByProvider, LeadCostEvent, LeadCosts, LeadDetail, LeadFact } from "@/lib/types";

function Section({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: typeof Phone;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function SourceChip({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  const domain = sourceDomain(url);
  if (!domain) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
    >
      <Globe className="size-3" />
      {domain}
    </a>
  );
}

function ContactVerificationBadge({ level }: { level: string }) {
  const normalized =
    level === "verified" || level === "corroborated" || level === "unverified"
      ? level
      : "unverified";
  const variant =
    normalized === "verified"
      ? "success"
      : normalized === "corroborated"
        ? "warning"
        : "secondary";
  const label =
    normalized === "verified"
      ? "Verified"
      : normalized === "corroborated"
        ? "Corroborated"
        : "Unverified";
  return (
    <Badge variant={variant} className="text-[10px]">
      {label}
    </Badge>
  );
}

function SourceRows({ sources }: { sources: ContactSource[] }) {
  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      {sources.map((source, i) => (
        <div
          key={`${source.source_url}-${source.label}-${i}`}
          className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] capitalize">
              {source.label}
            </Badge>
            <SourceChip url={source.source_url} />
            {source.method ? (
              <span className="text-muted-foreground">{source.method.replace(/_/g, " ")}</span>
            ) : null}
          </div>
          {source.quote ? (
            <p className="mt-1.5 line-clamp-3 text-muted-foreground">&ldquo;{source.quote}&rdquo;</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PhoneContactCard({ group }: { group: PhoneGroup }) {
  const [open, setOpen] = useState(false);
  const telHref = normalizePhoneKey(group.value);
  const label = primaryLabel(group.labels);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="glass rounded-xl border border-border/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {label}
              </Badge>
              {group.isPrimary ? (
                <Badge variant="secondary" className="text-[10px]">
                  Primary
                </Badge>
              ) : null}
              <ContactVerificationBadge level={group.verification} />
            </div>
            <a
              href={`tel:+1${telHref}`}
              className="block font-mono text-lg font-semibold tabular-nums text-primary hover:underline"
            >
              {group.display}
            </a>
            {group.labels.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                Also listed as: {group.labels.filter((l) => l !== label).join(" · ")}
              </p>
            ) : null}
          </div>
          {group.sources.length > 1 ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                {group.sources.length} sources
                <ChevronDown
                  className={cn("size-3.5 transition-transform", open && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <SourceChip url={group.sources[0]?.source_url} />
          )}
        </div>
        {group.sources.length === 1 ? (
          group.sources[0]?.quote ? (
            <p className="mt-2 line-clamp-3 text-xs italic text-muted-foreground">
              &ldquo;{group.sources[0].quote}&rdquo;
            </p>
          ) : null
        ) : (
          <CollapsibleContent>
            <SourceRows sources={group.sources} />
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

function EmailContactCard({ group }: { group: EmailGroup }) {
  const [open, setOpen] = useState(false);
  const label = primaryLabel(group.labels);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="glass rounded-xl border border-border/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {label}
              </Badge>
              <ContactVerificationBadge level={group.verification} />
            </div>
            <a
              href={`mailto:${group.value}`}
              className="block break-all text-sm font-medium text-primary hover:underline"
            >
              {group.value}
            </a>
          </div>
          {group.sources.length > 1 ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                {group.sources.length} sources
                <ChevronDown
                  className={cn("size-3.5 transition-transform", open && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <SourceChip url={group.sources[0]?.source_url} />
          )}
        </div>
        {group.sources.length > 1 ? (
          <CollapsibleContent>
            <SourceRows sources={group.sources} />
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function FactProvenanceRow({ fact }: { fact: LeadFact }) {
  const display =
    Object.entries(fact.value)
      .filter(([, v]) => v)
      .map(([k, v]) => (k === "phone" || k === "email" ? v : `${k}: ${v}`))
      .join(" · ") || fact.quote;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs">
      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
        {fact.fact_kind.replace(/_/g, " ")}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{display}</p>
        <p className="text-muted-foreground">
          {fact.source_kind}
          {fact.method ? ` · ${fact.method.replace(/_/g, " ")}` : ""}
        </p>
      </div>
      <SourceChip url={fact.source_url} />
    </div>
  );
}

function CostMetaDetails({ event }: { event: LeadCostEvent }) {
  const entries = Object.entries(event.meta).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="outline" className="text-[10px] font-normal">
          {key.replace(/_/g, " ")}:{" "}
          {typeof value === "number"
            ? Number.isInteger(value)
              ? value
              : value.toFixed(4)
            : String(value)}
        </Badge>
      ))}
    </div>
  );
}

function CostEventRow({ event }: { event: LeadCostEvent }) {
  const time = event.createdAt.slice(0, 19).replace("T", " ");

  return (
    <div className="rounded-lg border border-border/40 bg-card/50 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium capitalize">
              {event.operation.replace(/_/g, " ")}
            </span>
            <Badge
              variant={event.billing === "verified" ? "success" : "secondary"}
              className="text-[10px]"
            >
              {event.billing === "verified" ? "Verified" : "Estimated"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {formatCostUnits(event.provider, event.units, event.unitType)}
            {event.model ? ` · ${event.model}` : ""}
          </p>
          <CostMetaDetails event={event} />
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono font-semibold tabular-nums">{formatUsd(event.usd)}</p>
          <p className="text-[10px] text-muted-foreground">{time}</p>
        </div>
      </div>
      {event.runId ? (
        <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">
          run {event.runId.slice(0, 8)}…
        </p>
      ) : null}
    </div>
  );
}

function ProviderCostGroup({ group }: { group: LeadCostByProvider }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="glass rounded-xl border border-border/50">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/30"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{formatProvider(group.provider)}</p>
              <p className="text-xs text-muted-foreground">
                {group.eventCount} call{group.eventCount === 1 ? "" : "s"} ·{" "}
                {formatCostUnits(group.provider, group.unitsTotal, group.unitType)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatUsd(group.usdTotal)}
              </span>
              <ChevronDown
                className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
              />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border/50 px-4 py-3">
            {group.events.map((event) => (
              <CostEventRow key={event.id} event={event} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function LeadCostSection({ costs }: { costs: LeadCosts }) {
  const creditUsdEst = costs.firecrawlCreditsEst * 0.00533;

  if (costs.eventCount === 0) {
    return (
      <Section icon={DollarSign} title="Generation cost">
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No cost events recorded for this lead yet. Costs appear after a lead run completes with
          cost tracking enabled.
          {costs.firecrawlCreditsEst > 0 ? (
            <span className="mt-2 block">
              Run estimated ~{costs.firecrawlCreditsEst} Firecrawl credits (
              {formatUsd(creditUsdEst)}).
            </span>
          ) : null}
        </p>
      </Section>
    );
  }

  return (
    <Section icon={DollarSign} title="Generation cost">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="glass space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total recorded
          </p>
          <p className="font-mono text-2xl font-bold tabular-nums">{formatUsd(costs.totalUsd)}</p>
          <p className="text-xs text-muted-foreground">
            {costs.eventCount} tool call{costs.eventCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="glass space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verified / API-reported
          </p>
          <p className="font-mono text-2xl font-bold tabular-nums text-success">
            {formatUsd(costs.verifiedUsd)}
          </p>
          <p className="text-xs text-muted-foreground">
            Scrape credits, tokens, Browser Use passthrough
          </p>
        </div>
        <div className="glass space-y-1 rounded-xl border border-border/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estimated fallback
          </p>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {formatUsd(costs.estimatedUsd)}
          </p>
          {costs.firecrawlCreditsEst > 0 ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="size-3" />
              ~{costs.firecrawlCreditsEst} credits est. ({formatUsd(creditUsdEst)})
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Map/search credit fallbacks</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">By provider</p>
        {costs.byProvider.map((group) => (
          <ProviderCostGroup key={group.provider} group={group} />
        ))}
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
            All tool calls (chronological)
            <ChevronDown className="size-3.5" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {costs.events.map((event) => (
              <CostEventRow key={event.id} event={event} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

function LeadDetailContent({ placeId }: { placeId: string }) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new placeId fetch
    setLoading(true);

    const run = async () => {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(placeId)}`);
        const data = (await res.json()) as { lead?: LeadDetail };
        if (!cancelled) setLead(data.lead ?? null);
      } catch {
        if (!cancelled) setLead(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  const grouped = useMemo(
    () => (lead ? groupLeadContacts(lead) : null),
    [lead],
  );

  const scoreEntries = useMemo(
    () =>
      Object.entries(lead?.score_breakdown ?? {}).filter(
        ([, v]) => typeof v === "number" && v > 0,
      ),
    [lead?.score_breakdown],
  );
  const scoreTotal = scoreEntries.reduce((sum, [, v]) => sum + v, 0);

  const mainPhone = grouped?.phones.find((p) => p.isPrimary) ?? grouped?.phones[0];

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <DialogTitle className="sr-only">Loading lead details</DialogTitle>
        <DialogDescription className="sr-only">
          Fetching enriched lead contacts and provenance.
        </DialogDescription>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-48 lg:col-span-8" />
          <Skeleton className="h-48 lg:col-span-4" />
        </div>
      </div>
    );
  }

  if (!lead || !grouped) {
    return (
      <div className="p-6">
        <DialogTitle className="text-lg">Lead not found</DialogTitle>
        <DialogDescription className="mt-2">
          No record for this place id in the database.
        </DialogDescription>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-6 py-4 backdrop-blur-xl supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ScoreBadge score={lead.lead_score} />
              <SalesStatusBadge status={lead.status} />
              <VerificationBadge level={lead.verification_level ?? lead.confidence} />
            </div>
            <DialogTitle className="text-xl font-semibold leading-snug">
              {lead.business_name}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-1 text-sm">
              <MapPin className="size-3.5 shrink-0" />
              {[lead.address ?? lead.city, lead.market_key, lead.category_key]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mainPhone ? (
              <Button size="sm" asChild>
                <a href={`tel:+1${mainPhone.key}`}>
                  <Phone className="size-4" />
                  Call {mainPhone.display}
                </a>
              </Button>
            ) : null}
            {lead.website ? (
              <Button size="sm" variant="outline" asChild>
                <a href={lead.website} target="_blank" rel="noreferrer">
                  <Globe className="size-4" />
                  Website
                </a>
              </Button>
            ) : null}
            {lead.google_maps_url ? (
              <Button size="sm" variant="outline" asChild>
                <a href={lead.google_maps_url} target="_blank" rel="noreferrer">
                  <MapPin className="size-4" />
                  Maps
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-8 p-6">
          {lead.why_now ? (
            <p className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
              {lead.why_now}
            </p>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-8">
              <Section icon={Phone} title="Callable contacts">
                {grouped.phones.length === 0 && grouped.emails.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No verified callable contact yet — we don&apos;t guess names.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {grouped.phones.map((phone) => (
                      <PhoneContactCard key={phone.key} group={phone} />
                    ))}
                    {grouped.emails.map((email) => (
                      <EmailContactCard key={email.key} group={email} />
                    ))}
                  </div>
                )}
              </Section>

              {grouped.people.length > 0 ? (
                <Section icon={User} title="People to ask for">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {grouped.people.map((person) => (
                      <div
                        key={person.key}
                        className="glass rounded-xl border border-border/50 p-4"
                      >
                        <div className="flex items-start gap-2">
                          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{person.name}</p>
                            {person.title ? (
                              <p className="text-sm text-muted-foreground">{person.title}</p>
                            ) : null}
                            {person.company ? (
                              <p className="text-xs text-muted-foreground">{person.company}</p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {person.sources.map((s, i) => (
                                <SourceChip key={`${s.source_url}-${i}`} url={s.source_url} />
                              ))}
                            </div>
                          </div>
                          <ContactVerificationBadge level={person.verification} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>

            <div className="space-y-6 lg:col-span-4">
              {lead.why_good_fit ? (
                <Section icon={Lightbulb} title="Why call">
                  <div className="glass space-y-2 rounded-xl border border-border/50 p-4">
                    <Badge variant="outline" className="text-[10px]">
                      AI-written from verified facts
                    </Badge>
                    <p className="text-sm leading-relaxed">{lead.why_good_fit}</p>
                  </div>
                </Section>
              ) : null}

              {lead.talking_points ? (
                <Section icon={MessageCircle} title="Talking points">
                  <div className="glass rounded-xl border border-border/50 p-4">
                    <p className="whitespace-pre-line text-sm leading-relaxed">
                      {lead.talking_points}
                    </p>
                  </div>
                </Section>
              ) : null}

              {lead.need_signals ? (
                <Section icon={Lightbulb} title="Exterior cleaning signals">
                  <p className="text-sm text-muted-foreground">{lead.need_signals}</p>
                </Section>
              ) : null}

              {grouped.registry ? (
                <Section icon={User} title="BBB & registry">
                  <div className="glass space-y-3 rounded-xl border border-border/50 p-4 text-sm">
                    {grouped.registry.rating ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">BBB Rating</span>
                        <Badge variant="success">{grouped.registry.rating}</Badge>
                      </div>
                    ) : null}
                    {grouped.registry.yearsInBusiness ? (
                      <p>
                        <span className="text-muted-foreground">Years in business: </span>
                        {grouped.registry.yearsInBusiness}
                      </p>
                    ) : null}
                    {grouped.registry.accreditedSince ? (
                      <p>
                        <span className="text-muted-foreground">Accredited since: </span>
                        {grouped.registry.accreditedSince}
                      </p>
                    ) : null}
                    {grouped.registry.entityType ? (
                      <p>
                        <span className="text-muted-foreground">Entity: </span>
                        {grouped.registry.entityType}
                      </p>
                    ) : null}
                    {grouped.registry.alternateNames.length > 0 ? (
                      <div>
                        <p className="text-muted-foreground">Also known as</p>
                        <ul className="mt-1 list-inside list-disc">
                          {grouped.registry.alternateNames.map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {grouped.registry.sourceUrl ? (
                      <SourceChip url={grouped.registry.sourceUrl} />
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {grouped.socials.length > 0 ? (
                <Section icon={Globe} title="Socials">
                  <div className="flex flex-wrap gap-2">
                    {grouped.socials.map((social) => (
                      <a
                        key={social.key}
                        href={social.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-2 text-xs hover:bg-accent/50"
                      >
                        <SocialIcon platform={social.platform} />
                        {socialPlatformLabel(social.platform)}
                      </a>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          </div>

          <div className="space-y-6 rounded-2xl border border-border/50 bg-muted/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Details & provenance
            </p>

            <LeadCostSection costs={lead.costs} />

            {scoreEntries.length > 0 ? (
              <Section icon={BarChart3} title="Score breakdown">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {scoreEntries.map(([key, value]) => (
                    <div key={key} className="space-y-1 rounded-lg bg-card/60 p-3">
                      <div className="flex justify-between text-xs capitalize text-muted-foreground">
                        <span>{key.replace(/_/g, " ")}</span>
                        <span className="font-mono tabular-nums">{value}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{
                            width: `${Math.min(100, (value / Math.max(scoreTotal, 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Components sum to {scoreTotal}
                  {lead.lead_score != null && scoreTotal !== lead.lead_score
                    ? ` (capped at ${lead.lead_score})`
                    : ""}
                </p>
              </Section>
            ) : null}

            {lead.source_checks.length > 0 ? (
              <Section icon={Globe} title="Sources checked">
                <div className="flex flex-wrap gap-1.5">
                  {lead.source_checks.map((check) => (
                    <Badge
                      key={check.source_key}
                      variant={
                        check.status === "checked"
                          ? "default"
                          : check.status === "login_wall"
                            ? "secondary"
                            : "outline"
                      }
                      className="text-[10px] capitalize"
                      title={check.reason}
                    >
                      {check.source_key}: {check.status.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </Section>
            ) : null}

            {lead.facts.length > 0 ? (
              <Section icon={Globe} title="How we found this">
                <div className="grid gap-2 lg:grid-cols-2">
                  {lead.facts.map((fact, i) => (
                    <FactProvenanceRow key={`${fact.fact_kind}-${i}`} fact={fact} />
                  ))}
                </div>
              </Section>
            ) : null}

            {lead.website || lead.google_maps_url || lead.evidence_urls.length > 0 ? (
              <Section icon={Globe} title="Links">
                <div className="space-y-1">
                  {lead.website ? (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 break-all text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5 shrink-0" />
                      {lead.website}
                    </a>
                  ) : null}
                  {lead.google_maps_url ? (
                    <a
                      href={lead.google_maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <MapPin className="size-3.5 shrink-0" />
                      Google Maps
                    </a>
                  ) : null}
                  {lead.evidence_urls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 break-all text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      {url}
                    </a>
                  ))}
                </div>
              </Section>
            ) : null}

            {lead.related.length > 0 ? (
              <Section icon={Link2} title="Related properties">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {lead.related.map((rel) => (
                    <a
                      key={rel.place_id}
                      href={`/leads?place=${encodeURIComponent(rel.place_id)}`}
                      className="glass block rounded-xl border border-border/50 p-3 text-sm hover:bg-accent/40"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {rel.relation.replace(/_/g, " ")}
                        </Badge>
                        <span className="font-medium">{rel.business_name}</span>
                      </div>
                      {rel.city ? (
                        <p className="mt-1 text-xs text-muted-foreground">{rel.city}</p>
                      ) : null}
                    </a>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

export function LeadDetailModal({
  placeId,
  onClose,
}: {
  placeId: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(placeId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton
        className="glass-strong top-6 flex h-[calc(100vh-3rem)] w-[calc(100%-2rem)] max-w-6xl translate-x-[-50%] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        {placeId ? <LeadDetailContent placeId={placeId} /> : null}
      </DialogContent>
    </Dialog>
  );
}
