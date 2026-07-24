/**
 * Operator-facing vocabulary.
 *
 * Verified  = named decision-maker + local phone + verification_level=verified
 * Unverified = everything else that can still be worked (phone-only / no DM)
 * Leads     = all worked inventory (payload present) — not "enriched"
 *
 * DB columns (enriched_json, enrichment_status) stay as storage names.
 */

export type LeadStatusLabel = "Verified" | "Unverified";

export type InventoryMode = "verified" | "unverified" | "all" | "dud";

/** Map legacy URL/query values to current inventory modes. */
export function parseInventoryMode(raw: string | null | undefined): InventoryMode {
  switch (raw) {
    case "unverified":
    case "partial": // legacy
      return "unverified";
    case "all":
    case "all_quality": // legacy
      return "all";
    case "dud":
      return "dud";
    case "verified":
    case "ready": // legacy
    default:
      return "verified";
  }
}

export function inventoryModeLabel(mode: InventoryMode): string {
  switch (mode) {
    case "verified":
      return "Verified";
    case "unverified":
      return "Unverified";
    case "all":
      return "All leads";
    case "dud":
      return "Duds";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function displayLeadStatus(status: string | null | undefined): LeadStatusLabel {
  if (
    status === "Verified" ||
    status === "Ready to call" // legacy stored/computed
  ) {
    return "Verified";
  }
  return "Unverified";
}

export function displayVerificationLevel(
  level: string | null | undefined,
): { label: string; hint: string } {
  if (level === "verified" || level === "High") {
    return {
      label: "Verified",
      hint: "Named decision-maker with a grounded local phone.",
    };
  }
  if (level === "partial" || level === "Medium") {
    return {
      label: "Unverified",
      hint: "Callable phone on file — still missing a named decision-maker. Can be tried again.",
    };
  }
  return {
    label: "Unverified",
    hint: "No grounded callable contact yet — can be tried again.",
  };
}
