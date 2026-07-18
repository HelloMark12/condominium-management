/**
 * Billing display helpers — pure functions, fully testable.
 *
 * "Enterprise custom" is detected from the API response:
 *   currentPlan === 'enterprise' && estimatedAmountCents === 0
 *
 * This is driven by the DB pricing configuration:
 *   - calculateTier() assigns 'enterprise' only when peakUnits >= config.enterpriseStart
 *   - calculateEstimatedAmountCents() returns 0 only when enterprisePricingBehavior === 'custom'
 * Neither check uses a hardcoded apartment threshold; both use the active pricing_configs row.
 */

export type SubscriptionPlan = "free" | "standard" | "enterprise";

/**
 * Returns true when the billing is enterprise tier with custom (contact-for-pricing) behavior.
 * The signal is: plan is 'enterprise' AND the API returned 0 for estimated amount.
 *
 * For enterprise/per_unit or enterprise/fixed, estimatedAmountCents will be > 0
 * because the billing service calculates a real amount for those behaviors.
 */
export function isEnterpriseCustom(
  currentPlan: string,
  estimatedAmountCents: number | null | undefined,
): boolean {
  return currentPlan === "enterprise" && (estimatedAmountCents ?? 0) === 0;
}

/**
 * Returns the human-readable charge string for the current billing period.
 *
 * - Enterprise custom  → "Custom pricing"
 * - Free              → "€0.00 (Free)"
 * - Any other amount  → "€X.XX"
 */
export function formatEstimatedCharge(
  currentPlan: string,
  estimatedAmountCents: number | null | undefined,
): string {
  if (isEnterpriseCustom(currentPlan, estimatedAmountCents)) {
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
 * - Free              → "Your account is on the free plan. No charge this month."
 * - Standard/paid     → "Peak: N × €R.RR/apartment = €T.TT"
 */
export function formatChargeExplanation(
  currentPlan: string,
  peakActiveUnitCount: number,
  ratePerUnitCents: number | null | undefined,
  estimatedAmountCents: number | null | undefined,
): string {
  if (isEnterpriseCustom(currentPlan, estimatedAmountCents)) {
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
 * - Enterprise custom  → "Custom"
 * - Any other         → "€R.RR"
 */
export function formatHistoryRate(
  subscriptionTier: string | null | undefined,
  estimatedAmountCents: number | null | undefined,
  ratePerUnitCents: number | null | undefined,
): string {
  if (isEnterpriseCustom(subscriptionTier ?? "", estimatedAmountCents)) {
    return "Custom";
  }
  return `€${((ratePerUnitCents ?? 0) / 100).toFixed(2)}`;
}

/**
 * Returns the amount cell value for the history table.
 *
 * - Enterprise custom  → "Custom pricing"
 * - Finalised          → uses finalAmountCents if available
 * - Otherwise          → estimatedAmountCents
 */
export function formatHistoryAmount(
  subscriptionTier: string | null | undefined,
  estimatedAmountCents: number | null | undefined,
  finalAmountCents: number | null | undefined,
): string {
  if (isEnterpriseCustom(subscriptionTier ?? "", estimatedAmountCents)) {
    return "Custom pricing";
  }
  const amount = finalAmountCents ?? estimatedAmountCents ?? 0;
  return `€${(amount / 100).toFixed(2)}`;
}
