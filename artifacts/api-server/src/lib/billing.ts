/**
 * Billing service for the Condominium Management platform.
 *
 * All commercial thresholds and rates are read from the database (pricing_configs table).
 * No hardcoded commercial constants — use BillingService methods.
 *
 * Billing rules (configured in DB):
 * - Free:       ≤ freeUnitLimit active apartments, €0/month
 * - Standard:   standardMin–standardMax active apartments, ratePerUnitCents × peak
 * - Enterprise: ≥ enterpriseStart active apartments, behavior-dependent
 *
 * Monthly peak: highest simultaneous active count reached during the calendar month.
 * Billing is based on the peak, not the current count.
 * Timezone: Europe/Malta
 *
 * Only unit_type = 'apartment' counts toward billing.
 */

import { and, desc, gte, isNull, lte, or, eq } from "drizzle-orm";
import {
  db,
  pricingConfigsTable,
  companyPricingOverridesTable,
} from "@workspace/db";
import type {
  PricingConfig,
  CompanyPricingOverride,
} from "@workspace/db";

export const BILLING_TIMEZONE = "Europe/Malta";

export type SubscriptionTier = "free" | "standard" | "enterprise";

// ── Config retrieval ─────────────────────────────────────────────────────────

/**
 * Get the active pricing configuration for a given billing month (YYYY-MM-DD).
 * Throws explicitly if no active config is found — never silently falls back.
 */
export async function getActivePricingConfig(
  billingMonth: string,
): Promise<PricingConfig> {
  const configs = await db
    .select()
    .from(pricingConfigsTable)
    .where(
      and(
        eq(pricingConfigsTable.status, "active"),
        lte(pricingConfigsTable.effectiveFrom, billingMonth),
        or(
          isNull(pricingConfigsTable.effectiveTo),
          gte(pricingConfigsTable.effectiveTo, billingMonth),
        ),
      ),
    )
    .orderBy(desc(pricingConfigsTable.effectiveFrom))
    .limit(1);

  if (!configs[0]) {
    throw new Error(
      `No active pricing configuration found for billing month ${billingMonth}. ` +
        `Seed one via the DB seed script or admin API before billing can be calculated.`,
    );
  }
  return configs[0];
}

/**
 * Get the active company-specific pricing override for a billing month, or null.
 * Priority: override → platform config.
 */
export async function getCompanyPricingOverride(
  companyId: string,
  billingMonth: string,
): Promise<CompanyPricingOverride | null> {
  const overrides = await db
    .select()
    .from(companyPricingOverridesTable)
    .where(
      and(
        eq(companyPricingOverridesTable.companyId, companyId),
        eq(companyPricingOverridesTable.isActive, true),
        lte(companyPricingOverridesTable.startDate, billingMonth),
        or(
          isNull(companyPricingOverridesTable.endDate),
          gte(companyPricingOverridesTable.endDate, billingMonth),
        ),
      ),
    )
    .orderBy(desc(companyPricingOverridesTable.startDate))
    .limit(1);

  return overrides[0] ?? null;
}

// ── Calculation ──────────────────────────────────────────────────────────────

/**
 * Determine the subscription tier from a peak unit count, config, and optional override.
 */
export function calculateTier(
  peakUnits: number,
  config: PricingConfig,
  override?: CompanyPricingOverride | null,
): SubscriptionTier {
  const freeLimit = override?.customFreeUnitLimit ?? config.freeUnitLimit;
  const enterpriseStart =
    override?.customEnterpriseStart ?? config.enterpriseStart;

  if (peakUnits <= freeLimit) return "free";
  if (peakUnits < enterpriseStart) return "standard";
  return "enterprise";
}

/**
 * Calculate the estimated billing amount in cents from a peak unit count,
 * active pricing config, and optional company override.
 *
 * Returns 0 for free tier and for enterprise/custom (manual invoicing).
 */
export function calculateEstimatedAmountCents(
  peakUnits: number,
  config: PricingConfig,
  override?: CompanyPricingOverride | null,
): number {
  const tier = calculateTier(peakUnits, config, override);

  if (tier === "free") return 0;

  if (tier === "enterprise") {
    const behavior = config.enterprisePricingBehavior;
    if (behavior === "fixed") {
      return (
        override?.fixedMonthlyFeeCents ??
        config.enterpriseFixedRateCents ??
        0
      );
    }
    if (behavior === "per_unit") {
      const rate =
        override?.enterpriseCustomRateCents ??
        config.enterprisePerUnitRateCents ??
        config.ratePerUnitCents;
      return peakUnits * rate;
    }
    // "custom" — manual invoicing, not calculated
    return 0;
  }

  // Standard tier
  if (override?.fixedMonthlyFeeCents != null) {
    return override.fixedMonthlyFeeCents;
  }
  const rate = override?.customRatePerUnitCents ?? config.ratePerUnitCents;
  return peakUnits * rate;
}

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Get the first day of the current billing month in Europe/Malta time.
 * Returns an ISO date string, e.g. "2025-07-01".
 */
export function getCurrentBillingMonth(): string {
  const now = new Date();
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
 * Format cents as a Euro string (e.g. 500 → "€5.00").
 */
export function formatEuroCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
