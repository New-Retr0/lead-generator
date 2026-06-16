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
          : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
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
  partial: "Verified phone on file — no verified person name yet.",
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
