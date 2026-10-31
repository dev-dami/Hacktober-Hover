import type { CheckResult } from "./api";

export const VERDICT_KINDS = ["alert", "mismatch", "possible_alert", "match", "not_found", "unverified"] as const;
export type VerdictKind = (typeof VERDICT_KINDS)[number];

/** One headline for a check, most serious first: a named alert outranks any register result. */
export function verdictOf(result: CheckResult): VerdictKind {
  if (result.alerts.some((alert) => alert.strength === "strong")) return "alert";
  if (result.registry.status === "registered_details_differ") return "mismatch";
  if (result.alerts.length > 0) return "possible_alert";
  if (result.registry.status === "registered") return "match";
  if (result.registry.status === "not_in_greenbook") return "not_found";
  return "unverified";
}
