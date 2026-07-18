/**
 * Billing utilities for the Condominium Management platform.
 *
 * Billing rules:
 * - Free:     ≤ 2 active apartments, €0/month
 * - Standard: 3–49 active apartments, configurable rate per apartment (all apartments, not just above 2)
 * - Enterprise: ≥ 50 active apartments, custom pricing (not blocked)
 *
 * Monthly peak: highest simultaneous active count reached during the calendar month.
 * Billing is based on the peak, not the current count.
 * Timezone: Europe/Malta
 */

export const BILLING_TIMEZONE = "Europe/Malta";
export const FREE_UNIT_LIMIT = 2;
export const STANDARD_MAX_UNITS = 49;
export const DEFAULT_RATE_PER_UNIT_CENTS = 500; // €5.00

export type SubscriptionTier = "free" | "standard" | "enterprise";

export function calculateTier(peakUnits: number): SubscriptionTier {
  if (peakUnits <= FREE_UNIT_LIMIT) return "free";
  if (peakUnits <= STANDARD_MAX_UNITS) return "standard";
  return "enterprise";
}

export function calculateEstimatedAmountCents(
  peakUnits: number,
  ratePerUnitCents: number,
  tier: SubscriptionTier,
): number {
  if (tier === "free") return 0;
  if (tier === "enterprise") return 0; // Custom pricing — not calculated
  return peakUnits * ratePerUnitCents;
}

/**
 * Get the first day of the current billing month in Europe/Malta time as an ISO date string.
 * e.g. "2025-07-01"
 */
export function getCurrentBillingMonth(): string {
  const now = new Date();
  // Use Intl to get current Malta date
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

/**
 * Format cents as a Euro string (e.g. 500 → "€5.00")
 */
export function formatEuroCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
