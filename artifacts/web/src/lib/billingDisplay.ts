/**
 * Billing display helpers — pure functions, fully testable.
 *
 * Issue 7 FIX: Detection of enterprise custom pricing now uses an explicit
 * `isCustomPricing` boolean provided by the API, derived from:
 *   - Subscription route: tier === 'enterprise' && config.enterprisePricingBehavior === 'custom'
 *   - Usage history rows: subscriptionTier === 'enterprise' && snapshotEnterpriseBehavior === 'custom'
 *
 * This replaces the previous fragile inference of:
 *   currentPlan === 'enterprise' && estimatedAmountCents === 0
 *
 * Why the old inference was wrong:
 *   Enterprise/fixed with fixed_rate = 0 would have been misidentified as custom pricing
 *   because both produce estimatedAmountCents = 0.  The explicit field is set server-side
 *   from the enum value in pricing_configs and cannot produce false positives.
 */

export type SubscriptionPlan = "free" | "standard" | "enterprise";

/**
 * Returns true when the API has explicitly indicated enterprise custom pricing.
 * The API field `isCustomPricing` is set to true only when:
 *   - subscriptionTier = 'enterprise'  AND
 *   - enterprisePricingBehavior = 'custom'   (i.e. manual invoicing, not fixed or per_unit)
 */
export function isEnterpriseCustom(
  isCustomPricing: boolean | null | undefined,
): boolean {
  return isCustomPricing === true;
}

/**
 * Returns the human-readable charge string for the current billing period.
 *
 * - Enterprise custom (isCustomPricing=true)  → "Custom pricing"
 * - Free                                       → "€0.00 (Free)"
 * - Any other amount                           → "€X.XX"
 */
export function formatEstimatedCharge(
  currentPlan: string,
  estimatedAmountCents: number | null | undefined,
  isCustomPricing?: boolean | null,
): string {
  if (isEnterpriseCustom(isCustomPricing)) {
    return "Custom pricing";
  }
  const cents = estimatedAmountCents ?? 0;
  const euros = (cents / 100).toFixed(2);
  if (currentPlan === "free") {
    return `€${euros} (Free)`;
  }
  return `€${euros}`;
}

/**
 * Returns the explanation line shown below the main charge figure.
 *
 * - Enterprise custom  → "Your plan is billed at a custom rate. Contact us for your invoice."
 * - Free               → "Your account is on the free plan. No charge this month."
 * - Standard/paid      → "Peak: N × €R.RR/apartment = €T.TT"
 */
export function formatChargeExplanation(
  currentPlan: string,
  peakActiveUnitCount: number,
  ratePerUnitCents: number | null | undefined,
  estimatedAmountCents: number | null | undefined,
  isCustomPricing?: boolean | null,
): string {
  if (isEnterpriseCustom(isCustomPricing)) {
    return "Your plan is billed at a custom rate. Contact us for your invoice.";
  }
  if (currentPlan === "free") {
    return "Your account is on the free plan. No charge this month.";
  }
  const rate = ratePerUnitCents ?? 0;
  const total = estimatedAmountCents ?? 0;
  return `Peak: ${peakActiveUnitCount} × €${(rate / 100).toFixed(2)}/apartment = €${(total / 100).toFixed(2)}`;
}

/**
 * Returns the rate-per-unit cell value for the history table.
 *
 * - Enterprise custom (isCustomPricing=true)  → "Custom"
 * - Any other                                  → "€R.RR"
 */
export function formatHistoryRate(
  subscriptionTier: string | null | undefined,
  estimatedAmountCents: number | null | undefined,
  ratePerUnitCents: number | null | undefined,
  isCustomPricing?: boolean | null,
): string {
  if (isEnterpriseCustom(isCustomPricing)) {
    return "Custom";
  }
  return `€${((ratePerUnitCents ?? 0) / 100).toFixed(2)}`;
}

/**
 * Returns the amount cell value for the history table.
 *
 * - Enterprise custom (isCustomPricing=true)  → "Custom pricing"
 * - Finalised                                  → uses finalAmountCents if available
 * - Otherwise                                  → estimatedAmountCents
 */
export function formatHistoryAmount(
  subscriptionTier: string | null | undefined,
  estimatedAmountCents: number | null | undefined,
  finalAmountCents: number | null | undefined,
  isCustomPricing?: boolean | null,
): string {
  if (isEnterpriseCustom(isCustomPricing)) {
    return "Custom pricing";
  }
  const amount = finalAmountCents ?? estimatedAmountCents ?? 0;
  return `€${(amount / 100).toFixed(2)}`;
}
