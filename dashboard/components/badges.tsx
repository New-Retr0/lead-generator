import { LiveDot } from "@/components/animated";
import { Badge } from "@/components/ui/badge";

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <Badge variant="outline">—</Badge>;
  }
  const variant = score >= 70 ? "success" : score >= 40 ? "warning" : "danger";
  return (
    <Badge variant={variant} className="tabular-nums">
      {score}
    </Badge>
  );
}

export function SalesStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "Ready to call" ? "success" : "secondary"}>
      {status}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const variant =
    status === "completed"
      ? "success"
      : status === "running"
        ? "warning"
        : status === "failed"
          ? "danger"
          : status === "cancelled"
            ? "outline"
            : status === "firecrawl_credits_exhausted"
              ? "warning"
              : "secondary";
  const label =
    status === "firecrawl_credits_exhausted" ? "CREDITS CAP" : status.replace(/_/g, " ");
  return (
    <Badge variant={variant}>
      {status === "running" ? <LiveDot tone="warning" className="size-1.5" /> : null}
      {label}
    </Badge>
  );
}

const STOP_REASON_VARIANT: Record<string, "outline" | "warning" | "danger" | "secondary"> = {
  empty_discovery: "secondary",
  credit_cap: "warning",
  firecrawl_credits_exhausted: "warning",
  session_credit_stop: "warning",
  http_402: "warning",
  grounding_storm: "warning",
  cancelled: "outline",
  interrupted: "outline",
  worker_offline: "danger",
  exception: "danger",
  failed: "danger",
};

/** Normalize status/stop_reason into a displayable stop badge. */
export function resolveStopReason(
  reason: string | null | undefined,
  status?: string | null,
  discoveredCount?: number | null,
): string | null {
  if (reason) return reason;
  if (status === "firecrawl_credits_exhausted") return "credit_cap";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  if (status === "completed" && discoveredCount === 0) return "empty_discovery";
  return null;
}

export function StopReasonBadge({
  reason,
  detail,
  status,
  discoveredCount,
}: {
  reason: string | null | undefined;
  detail?: string | null;
  status?: string | null;
  discoveredCount?: number | null;
}) {
  const resolved = resolveStopReason(reason, status, discoveredCount);
  if (!resolved) return null;
  // Avoid "FAILED · FAILED" when status and stop_reason are the same signal.
  if (status && resolved.replace(/_/g, " ") === status.replace(/_/g, " ")) {
    return null;
  }
  if (status === "failed" && resolved === "failed") return null;
  if (status === "cancelled" && resolved === "cancelled") return null;
  const label = resolved.replace(/_/g, " ");
  const title = detail?.trim() ? detail : undefined;
  const variant = STOP_REASON_VARIANT[resolved] ?? "outline";
  return (
    <Badge variant={variant} className="max-w-[14rem] truncate font-normal" title={title}>
      {label}
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return <Badge variant="outline">—</Badge>;
  const variant =
    confidence === "High"
      ? "success"
      : confidence === "Medium"
        ? "warning"
        : "secondary";
  return <Badge variant={variant}>{confidence}</Badge>;
}

const VERIFICATION_HINTS: Record<string, string> = {
  verified: "Callable verified phone and at least one verified person name.",
  partial: "Callable phone on file — no atomic named decision-maker yet.",
  unverified: "No grounded callable contact — we do not guess names.",
};

export function VerificationBadge({
  level,
}: {
  level: string | null | undefined;
}) {
  const normalized =
    level === "verified" || level === "partial" || level === "unverified"
      ? level
      : level === "High"
        ? "verified"
        : level === "Medium"
          ? "partial"
          : "unverified";
  const variant =
    normalized === "verified"
      ? "success"
      : normalized === "partial"
        ? "warning"
        : "secondary";
  const label =
    normalized === "verified"
      ? "Verified"
      : normalized === "partial"
        ? "Partial"
        : "Unverified";
  return (
    <Badge variant={variant} title={VERIFICATION_HINTS[normalized]}>
      {label}
    </Badge>
  );
}
