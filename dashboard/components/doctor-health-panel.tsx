"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  MinusCircle,
  SquareTerminal,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AnimatedNumber,
  LiveDot,
  Stagger,
  StaggerItem,
  TypingDots,
} from "@/components/animated";
import { Button } from "@/components/ui/button";
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

function redactSecret(detail: string): string {
  return detail.replace(/(postgresql:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

function parseDoctorLogs(lines: string[]): HealthCheck[] {
  const checks: HealthCheck[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || SKIP_LINE.test(line)) continue;

    const detailMatch = line.match(/^ {2}(.+)$/);
    if (detailMatch && checks.length > 0) {
      const detail = redactSecret(detailMatch[1]);
      if (/^WARNING:/i.test(detail)) {
        const parent = checks[checks.length - 1];
        if (parent.status === "ok") parent.status = "warn";
      }
      checks[checks.length - 1].details.push(detail);
      continue;
    }

    const leadDb = line.match(/^Lead DB:\s*(.+?) — (\d+) lead\(s\), (\d+) enriched/);
    if (leadDb) {
      checks.push({
        service: "Lead database",
        status: "ok",
        message: `${leadDb[2]} leads, ${leadDb[3]} enriched`,
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

function CheckRow({ check }: { check: HealthCheck }) {
  const meta = STATUS_META[check.status];
  const Icon = meta.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 px-3.5 py-3"
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
          meta.chip,
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold leading-tight">{check.service}</p>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              meta.chip,
            )}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{check.message}</p>
        {check.details.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {check.details.map((detail) => (
              <li
                key={detail}
                className="font-mono text-[11px] leading-snug text-muted-foreground/90"
              >
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
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
      <div className="glass rounded-xl px-3 py-2">
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
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState("running");
  const [showRaw, setShowRaw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasLiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    wasLiveRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jobId change reset
    setLines([]);
    setStatus("running");

    void fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((body: { job?: { status: string; logs?: string[] } }) => {
        if (cancelled) return;
        const initial = body.job?.status ?? "running";
        setStatus(initial);
        if (body.job?.logs?.length) setLines(body.job.logs);
        wasLiveRef.current = initial === "running";
      })
      .catch(() => {
        if (!cancelled) wasLiveRef.current = true;
      });

    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.addEventListener("log", (event) => {
      const data = JSON.parse(event.data) as { line: string };
      setLines((prev) => [...prev, data.line]);
    });

    source.addEventListener("done", (event) => {
      const data = JSON.parse(event.data) as { status: string };
      setStatus(data.status);
      if (wasLiveRef.current) onDone?.(data.status);
      source.close();
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setStatus("error");
      source.close();
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [jobId, onDone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines, showRaw]);

  const checks = useMemo(() => parseDoctorLogs(lines), [lines]);
  const running = status === "running";
  const passedChecks = checks.filter((c) => c.status === "ok").length;
  const warnChecks = checks.filter((c) => c.status === "warn").length;
  const failedChecks = checks.filter((c) => c.status === "fail" || c.status === "missing").length;

  return (
    <div className={cn("rounded-2xl", running && "live-ring p-px")}>
      <div className="glass-strong glass-sheen flex max-h-[70vh] flex-col overflow-hidden rounded-2xl">
        {running && !reduced ? (
          <motion.div
            className="h-0.5 w-full bg-muted"
            initial={false}
          >
            <motion.div
              className="h-full w-1/3 bg-primary"
              animate={{ x: ["-100%", "400%"] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        ) : null}

        <div className="relative shrink-0 border-b border-border/50 px-5 pb-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AnimatePresence mode="wait">
                <motion.span
                  key={running ? "running" : status}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl text-white shadow-lg",
                    running
                      ? "bg-gradient-to-br from-primary to-[oklch(0.6_0.16_300)]"
                      : status === "completed" && failedChecks === 0
                        ? "bg-gradient-to-br from-success to-[oklch(0.62_0.13_183)]"
                        : "bg-gradient-to-br from-destructive to-[oklch(0.55_0.2_15)]",
                  )}
                >
                  <Stethoscope className="size-4.5" strokeWidth={2.25} />
                </motion.span>
              </AnimatePresence>
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Health check
                  {running ? <LiveDot tone="primary" /> : null}
                </p>
                <p className="text-xs capitalize text-muted-foreground">
                  {running
                    ? "Verifying integrations…"
                    : status === "completed"
                      ? failedChecks > 0
                        ? `${failedChecks} issue${failedChecks === 1 ? "" : "s"} found`
                        : warnChecks > 0
                          ? `Passed with ${warnChecks} warning${warnChecks === 1 ? "" : "s"}`
                          : "All checks passed"
                      : status}
                </p>
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
          </div>

          {checks.length > 0 || running ? (
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
            <pre className="max-h-full overflow-auto rounded-xl border border-white/5 bg-[oklch(0.15_0.02_262)] p-3.5 font-mono text-[11px] leading-relaxed text-[oklch(0.84_0.01_250)] shadow-inner">
              {lines.filter((line) => !line.startsWith("$")).join("\n") || "Waiting for output…"}
              <div ref={bottomRef} />
            </pre>
          ) : (
            <div className="flex max-h-full min-h-0 flex-col overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {checks.map((check) => (
                  <CheckRow key={check.service} check={check} />
                ))}
              </AnimatePresence>
              {running ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border/50 px-3 py-3 text-xs text-muted-foreground"
                >
                  <span className="size-2 animate-pulse rounded-full bg-muted-foreground/40" />
                  Checking next service…
                  <TypingDots />
                </motion.div>
              ) : checks.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No check results captured
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
