"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  LoaderCircle,
  MinusCircle,
  Search,
  SquareTerminal,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  AnimatedNumber,
  LiveDot,
  Stagger,
  StaggerItem,
} from "@/components/animated";
import { doctorReveal, liveState, progress, spring } from "@/components/console/motion";
import { Button } from "@/components/ui/button";
import { useSafeReducedMotion } from "@/hooks/use-hydrated";
import { useJobStream } from "@/hooks/use-job-stream";
import { cn } from "@/lib/utils";

type CheckStatus = "ok" | "warn" | "fail" | "info" | "missing" | "disabled";

type HealthCheck = {
  service: string;
  status: CheckStatus;
  message: string;
  details: string[];
};

const STATUS_META: Record<
  CheckStatus,
  { label: string; icon: typeof CheckCircle2; chip: string }
> = {
  ok: {
    label: "OK",
    icon: CheckCircle2,
    chip: "border-success/40 bg-success/12 text-success",
  },
  warn: {
    label: "Warn",
    icon: AlertTriangle,
    chip: "border-warning/45 bg-warning/12 text-warning",
  },
  fail: {
    label: "Fail",
    icon: XCircle,
    chip: "border-destructive/45 bg-destructive/12 text-destructive",
  },
  missing: {
    label: "Missing",
    icon: MinusCircle,
    chip: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  disabled: {
    label: "Off",
    icon: CircleOff,
    chip: "border-border bg-muted/50 text-muted-foreground",
  },
  info: {
    label: "Info",
    icon: Stethoscope,
    chip: "border-primary/40 bg-primary/10 text-primary",
  },
};

const SKIP_LINE =
  /^(?:\$|--- exit|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}.*INFO httpx)/;

const EXPECTED_CHECKS = [
  "Places API (New)",
  "Firecrawl",
  "Supabase",
  "Lead database",
] as const;

/** Indented Firecrawl balance/plan lines printed after Lead DB in `doctor`. */
const FIRECRAWL_DETAIL =
  /^(?:Firecrawl\b|Billing (?:cycle|period)|Projected cycle|WARNING:.*(?:Firecrawl|credits))/i;

function redactSecret(detail: string): string {
  return detail.replace(/(postgresql:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

function findCheck(checks: HealthCheck[], service: string): HealthCheck | undefined {
  return checks.find((check) => check.service === service);
}

function attachDetail(checks: HealthCheck[], detail: string): void {
  if (checks.length === 0) return;

  let parent = checks[checks.length - 1];
  if (FIRECRAWL_DETAIL.test(detail)) {
    const firecrawl = findCheck(checks, "Firecrawl");
    if (firecrawl) parent = firecrawl;
  } else if (
    parent.service === "Lead database" &&
    /^(?:Firecrawl\b|Billing |Projected cycle)/i.test(detail)
  ) {
    const firecrawl = findCheck(checks, "Firecrawl");
    if (firecrawl) parent = firecrawl;
  }

  if (/^WARNING:/i.test(detail) && parent.status === "ok") {
    parent.status = "warn";
  }
  parent.details.push(detail);
}

function parseDoctorJson(lines: string[]): HealthCheck[] | null {
  const joined = lines.join("\n");
  const start = joined.indexOf("{");
  const end = joined.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(joined.slice(start, end + 1)) as {
      checks?: Array<{
        service?: string;
        status?: CheckStatus;
        message?: string;
        details?: string[];
      }>;
    };
    if (!Array.isArray(parsed.checks) || parsed.checks.length === 0) return null;
    return parsed.checks
      .filter((c) => typeof c.service === "string")
      .map((c) => ({
        service: c.service as string,
        status: (c.status ?? "info") as CheckStatus,
        message: String(c.message ?? ""),
        details: Array.isArray(c.details) ? c.details.map(String) : [],
      }));
  } catch {
    return null;
  }
}

function parseDoctorLogs(lines: string[]): HealthCheck[] {
  const fromJson = parseDoctorJson(lines);
  if (fromJson) return fromJson;

  const checks: HealthCheck[] = [];

  for (const raw of lines) {
    // Blank lines break detail attachment so later indented blocks don't stick
    // to the previous service (e.g. Firecrawl snapshots after Lead DB).
    if (!raw.trim()) continue;

    const detailMatch = raw.match(/^\s{2,}(.+)$/);
    const line = raw.trim();
    if (SKIP_LINE.test(line)) continue;

    if (detailMatch) {
      attachDetail(checks, redactSecret(detailMatch[1]));
      continue;
    }

    const leadDb = line.match(
      /^Lead DB:\s*(.+?) — (\d+) lead\(s\), (\d+) (?:researched|enriched)/,
    );
    if (leadDb) {
      checks.push({
        service: "Lead database",
        status: "ok",
        message: `${leadDb[2]} leads, ${leadDb[3]} researched`,
        details: [redactSecret(leadDb[1])],
      });
      continue;
    }

    const configured = line.match(/^([^:]+):\s*configured(?:\s*\((.+)\))?$/i);
    if (configured) {
      checks.push({
        service: configured[1].trim(),
        status: "ok",
        message: configured[2]?.trim() || "configured",
        details: [],
      });
      continue;
    }

    const main = line.match(
      /^([^:]+):\s*(OK|FAIL|WARN|MISSING|INCOMPLETE|disabled|not configured)(?:\s*—\s*(.+))?$/i,
    );
    if (main) {
      const statusRaw = main[2].toLowerCase();
      let status: CheckStatus = "info";
      if (statusRaw === "ok") status = "ok";
      else if (statusRaw === "fail") status = "fail";
      else if (statusRaw === "warn") status = "warn";
      else if (statusRaw === "missing" || statusRaw === "incomplete") status = "missing";
      else if (statusRaw === "disabled" || statusRaw === "not configured") status = "disabled";

      checks.push({
        service: main[1].trim(),
        status,
        message: main[3]?.trim() || main[2],
        details: [],
      });
      continue;
    }

    const disabled = line.match(/^([^:]+):\s*disabled\s*(?:\((.+)\))?$/i);
    if (disabled) {
      checks.push({
        service: disabled[1].trim(),
        status: "disabled",
        message: disabled[2] || "disabled",
        details: [],
      });
      continue;
    }

    const configuredDisabled = line.match(/^([^:]+):\s*configured but disabled\s*(?:\((.+)\))?$/i);
    if (configuredDisabled) {
      checks.push({
        service: configuredDisabled[1].trim(),
        status: "disabled",
        message: configuredDisabled[2] || "configured but disabled",
        details: [],
      });
    }
  }

  return checks;
}

function checkLayoutId(service: string): string {
  return `doctor-check-${service}`;
}

function CheckRow({ check }: { check: HealthCheck }) {
  const meta = STATUS_META[check.status];
  const Icon = meta.icon;
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      layout
      layoutId={checkLayoutId(check.service)}
      initial={reduced ? false : doctorReveal.row.initial}
      animate={doctorReveal.row.animate}
      exit={reduced ? undefined : doctorReveal.row.exit}
      transition={reduced ? { duration: 0 } : doctorReveal.row.transition}
      className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 px-3.5 py-3"
    >
      <motion.span
        initial={reduced ? false : doctorReveal.statusPop.initial}
        animate={doctorReveal.statusPop.animate}
        transition={reduced ? { duration: 0 } : doctorReveal.statusPop.transition}
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
          meta.chip,
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.25} />
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold leading-tight">{check.service}</p>
          <motion.span
            initial={reduced ? false : doctorReveal.statusPop.initial}
            animate={doctorReveal.statusPop.animate}
            transition={
              reduced
                ? { duration: 0 }
                : { ...doctorReveal.statusPop.transition, delay: 0.05 }
            }
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              meta.chip,
            )}
          >
            {meta.label}
          </motion.span>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{check.message}</p>
        {check.details.length > 0 ? (
          <motion.ul
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            className="mt-2 space-y-1 overflow-hidden"
          >
            {check.details.map((detail) => (
              <li
                key={detail}
                className="font-mono text-[11px] leading-snug text-muted-foreground/90"
              >
                {detail}
              </li>
            ))}
          </motion.ul>
        ) : null}
      </div>
    </motion.div>
  );
}

function PendingCheckRow({ service, active }: { service: string; active: boolean }) {
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      layout
      layoutId={checkLayoutId(service)}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0, y: -4 }}
      transition={spring.soft}
      className={cn(
        "rounded-xl border px-3.5 py-3",
        active
          ? "border-primary/35 bg-primary/10"
          : "border-dashed border-border/50 bg-muted/20",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
            active
              ? "border-primary/40 bg-primary/12 text-primary"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          {active ? (
            <motion.span
              animate={reduced ? undefined : { rotate: liveState.spinner.rotate }}
              transition={liveState.spinner.transition}
            >
              <LoaderCircle className="size-3.5" strokeWidth={2.25} />
            </motion.span>
          ) : (
            <Search className="size-3.5" strokeWidth={2.25} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold leading-tight">{service}</p>
            <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {active ? "Running" : "Pending"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {active ? "Checking service…" : "Waiting in sequence"}
          </p>
          {active ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/15">
              <motion.div
                className="h-full w-1/2 rounded-full bg-primary/70"
                animate={reduced ? undefined : { x: ["-60%", "160%"] }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 1.25, ease: "linear", repeat: Infinity }
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive" | "muted";
}) {
  return (
    <StaggerItem>
      <div className="panel rounded-xl px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-lg font-bold tabular-nums leading-none",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          <AnimatedNumber value={value} />
        </p>
      </div>
    </StaggerItem>
  );
}

export function DoctorHealthPanel({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (status: string) => void;
}) {
  const reduced = useSafeReducedMotion();
  const instantReveal = reduced;
  const { lines, status, phase, retry } = useJobStream({ jobId, onDone });
  const [showRaw, setShowRaw] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const checks = useMemo(() => parseDoctorLogs(lines), [lines]);
  const streamRunning = status === "running" || status === "pending";

  // Pace reveals (~520ms each) so a fast JSON dump doesn't flash every row at once.
  // Remount via key={jobId} resets revealedCount for a new health check.
  useEffect(() => {
    if (instantReveal) return;
    if (checks.length <= revealedCount) return;
    const timer = window.setTimeout(() => {
      setRevealedCount((n) => Math.min(n + 1, checks.length));
    }, doctorReveal.stepMs);
    return () => window.clearTimeout(timer);
  }, [checks.length, revealedCount, instantReveal]);

  const visibleCount = instantReveal ? checks.length : revealedCount;
  const visibleChecks = checks.slice(0, visibleCount);
  const revealing = !instantReveal && visibleCount < checks.length;
  const working = streamRunning || revealing;
  const passedChecks = visibleChecks.filter((c) => c.status === "ok").length;
  const warnChecks = visibleChecks.filter((c) => c.status === "warn").length;
  const failedChecks = visibleChecks.filter(
    (c) => c.status === "fail" || c.status === "missing",
  ).length;
  const visibleServices = new Set(visibleChecks.map((check) => check.service));
  const pendingChecks = working
    ? EXPECTED_CHECKS.filter((service) => !visibleServices.has(service))
    : [];

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    scrollArea?.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: instantReveal ? "auto" : "smooth",
    });
  }, [visibleChecks.length, pendingChecks.length, instantReveal, showRaw]);

  const headline = working
    ? revealing && !streamRunning
      ? "Settling results…"
      : "Verifying integrations…"
    : status === "completed"
      ? failedChecks > 0
        ? `${failedChecks} issue${failedChecks === 1 ? "" : "s"} found`
        : warnChecks > 0
          ? `Passed with ${warnChecks} warning${warnChecks === 1 ? "" : "s"}`
          : "All checks passed"
      : status;

  return (
    <div className="panel-strong panel-sheen flex h-[min(64dvh,660px)] min-h-0 flex-col overflow-hidden rounded-2xl">
      {working && !instantReveal ? (
        <div className={progress.trackClass}>
          <motion.div
            className={progress.fillClass}
            animate={{ x: ["-100%", "400%"] }}
            transition={progress.bar}
          />
        </div>
      ) : null}

      <div className="relative shrink-0 border-b border-border/50 px-5 pb-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              <motion.span
                key={working ? "running" : status}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={spring.snappy}
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl text-white shadow-lg",
                  working
                    ? "bg-gradient-to-br from-primary to-primary/80"
                    : status === "completed" && failedChecks === 0
                      ? "bg-gradient-to-br from-success to-success/80"
                      : "bg-gradient-to-br from-destructive to-destructive/80",
                )}
              >
                {working && !instantReveal ? (
                  <motion.span
                    animate={{ rotate: liveState.spinner.rotate }}
                    transition={liveState.spinner.transition}
                    className="flex"
                  >
                    <LoaderCircle className="size-4.5" strokeWidth={2.25} />
                  </motion.span>
                ) : (
                  <Stethoscope className="size-4.5" strokeWidth={2.25} />
                )}
              </motion.span>
            </AnimatePresence>
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                Health check
                {working ? <LiveDot tone="primary" /> : null}
              </p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={headline}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22 }}
                  className="text-xs capitalize text-muted-foreground"
                >
                  {headline}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={showRaw ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setShowRaw((v) => !v)}
          >
            <SquareTerminal className="size-3.5" />
            Raw
          </Button>
          {phase === "polling" || phase === "reconnecting" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              onClick={retry}
            >
              Retry stream
            </Button>
          ) : null}
        </div>

        {visibleChecks.length > 0 || working ? (
          <Stagger className="mt-4 grid grid-cols-3 gap-2">
            <SummaryTile label="Passed" value={passedChecks} tone="success" />
            <SummaryTile
              label="Warnings"
              value={warnChecks}
              tone={warnChecks > 0 ? "warning" : "muted"}
            />
            <SummaryTile
              label="Issues"
              value={failedChecks}
              tone={failedChecks > 0 ? "destructive" : "muted"}
            />
          </Stagger>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-3">
        {showRaw ? (
          <div
            ref={scrollAreaRef}
            className="max-h-full overflow-auto rounded-xl border border-white/5 bg-[#0b0b0b] p-3.5 shadow-inner"
          >
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#ece9e1]">
              {lines.filter((line) => !line.startsWith("$")).join("\n") ||
                "Waiting for output..."}
            </pre>
          </div>
        ) : (
          <div
            ref={scrollAreaRef}
            className="flex max-h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {visibleChecks.map((check) => (
                <CheckRow key={check.service} check={check} />
              ))}
              {pendingChecks.map((service, index) => (
                <PendingCheckRow
                  key={`pending-${service}`}
                  service={service}
                  active={index === 0}
                />
              ))}
            </AnimatePresence>
            {working && pendingChecks.length === 0 && revealing ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border/50 px-3 py-3 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3.5 animate-spin" />
                Revealing remaining checks…
              </motion.div>
            ) : !working && checks.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No check results captured
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
