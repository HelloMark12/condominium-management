/**
 * Test Suite 36b — Enterprise custom pricing display (Issue 7 / L3 fix)
 *
 * Proves that:
 *  - isEnterpriseCustom uses the explicit isCustomPricing field from the API
 *  - Enterprise/custom with estimate=0 → "Custom pricing"
 *  - Enterprise/fixed with fixed_rate=0 → "€0.00" (NOT "Custom pricing")
 *  - Enterprise/per_unit with rate=0    → "€0.00" (NOT "Custom pricing")
 *  - Enterprise/fixed with positive amount → "€X.XX"
 *  - Enterprise/per_unit with positive amount → "€X.XX"
 *  - Free and standard plans are unaffected
 *  - History table rows for enterprise custom show "Custom pricing" / "Custom", not "€0.00"
 */

import { describe, it, expect } from "vitest";
import {
  isEnterpriseCustom,
  formatEstimatedCharge,
  formatChargeExplanation,
  formatHistoryRate,
  formatHistoryAmount,
} from "@/lib/billingDisplay";

describe("Suite 36b — Enterprise custom pricing display (Issue 7 / L3)", () => {

  // ── isEnterpriseCustom ────────────────────────────────────────────────────
  // Now takes explicit boolean field from the API (Issue 7 FIX).

  describe("isEnterpriseCustom(isCustomPricing)", () => {
    it("returns true when isCustomPricing is explicitly true", () => {
      expect(isEnterpriseCustom(true)).toBe(true);
    });

    it("returns false when isCustomPricing is explicitly false", () => {
      expect(isEnterpriseCustom(false)).toBe(false);
    });

    it("returns false when isCustomPricing is null (no API field)", () => {
      expect(isEnterpriseCustom(null)).toBe(false);
    });

    it("returns false when isCustomPricing is undefined (not provided)", () => {
      expect(isEnterpriseCustom(undefined)).toBe(false);
    });
  });

  // ── formatEstimatedCharge — the critical "no €0.00" assertion ─────────────

  describe("formatEstimatedCharge(plan, amountCents, isCustomPricing)", () => {

    // Issue 7: Enterprise custom (isCustomPricing=true)
    it("enterprise custom with estimate=0 → 'Custom pricing'", () => {
      expect(formatEstimatedCharge("enterprise", 0, true)).toBe("Custom pricing");
    });

    it("MUST NOT return '€0.00' for enterprise custom pricing", () => {
      const result = formatEstimatedCharge("enterprise", 0, true);
      expect(result).not.toBe("€0.00");
      expect(result).not.toContain("€0.00");
    });

    it("enterprise custom with null estimate → 'Custom pricing'", () => {
      expect(formatEstimatedCharge("enterprise", null, true)).toBe("Custom pricing");
    });

    // Issue 7: Enterprise fixed with rate=0 (isCustomPricing=false) → €0.00 NOT Custom
    it("enterprise fixed with fixed_rate=0 (isCustomPricing=false) → '€0.00'", () => {
      const result = formatEstimatedCharge("enterprise", 0, false);
      expect(result).toBe("€0.00");
      expect(result).not.toBe("Custom pricing");
    });

    // Issue 7: Enterprise per_unit with rate=0 (isCustomPricing=false) → €0.00 NOT Custom
    it("enterprise per_unit with rate=0 (isCustomPricing=false) → '€0.00'", () => {
      const result = formatEstimatedCharge("enterprise", 0, false);
      expect(result).toBe("€0.00");
      expect(result).not.toBe("Custom pricing");
    });

    // Issue 7: Enterprise fixed with positive amount
    it("enterprise fixed with positive amount (isCustomPricing=false) → '€X.XX'", () => {
      expect(formatEstimatedCharge("enterprise", 100000, false)).toBe("€1000.00");
    });

    // Issue 7: Enterprise per_unit with positive amount
    it("enterprise per_unit with positive amount (isCustomPricing=false) → '€X.XX'", () => {
      expect(formatEstimatedCharge("enterprise", 15000, false)).toBe("€150.00");
    });

    it("free plan → '€0.00 (Free)'", () => {
      expect(formatEstimatedCharge("free", 0, false)).toBe("€0.00 (Free)");
    });

    it("free plan without isCustomPricing → '€0.00 (Free)'", () => {
      expect(formatEstimatedCharge("free", 0)).toBe("€0.00 (Free)");
    });

    it("standard plan → correct euro amount", () => {
      expect(formatEstimatedCharge("standard", 5000, false)).toBe("€50.00");
    });

    it("enterprise custom with non-zero estimate (edge case) → 'Custom pricing'", () => {
      // If isCustomPricing=true, always show custom regardless of amount
      expect(formatEstimatedCharge("enterprise", 99999, true)).toBe("Custom pricing");
    });
  });

  // ── formatChargeExplanation ───────────────────────────────────────────────

  describe("formatChargeExplanation(plan, peak, rate, amount, isCustomPricing)", () => {
    it("enterprise custom (isCustomPricing=true) → contact-us message", () => {
      const result = formatChargeExplanation("enterprise", 60, 500, 0, true);
      expect(result).toMatch(/contact us/i);
      expect(result).toMatch(/custom rate/i);
    });

    it("MUST NOT contain '€0.00' for enterprise custom pricing", () => {
      const result = formatChargeExplanation("enterprise", 60, 500, 0, true);
      expect(result).not.toContain("€0.00");
    });

    it("enterprise fixed with rate=0 (isCustomPricing=false) → formula, not contact-us", () => {
      const result = formatChargeExplanation("enterprise", 60, 0, 0, false);
      expect(result).not.toMatch(/contact us/i);
    });

    it("returns free plan message for free tier", () => {
      const result = formatChargeExplanation("free", 1, 0, 0, false);
      expect(result).toMatch(/free plan/i);
      expect(result).toMatch(/no charge/i);
    });

    it("returns formula for standard plan", () => {
      const result = formatChargeExplanation("standard", 10, 500, 5000, false);
      expect(result).toContain("10");
      expect(result).toContain("€5.00");
      expect(result).toContain("€50.00");
    });

    it("enterprise per_unit with positive amount (isCustomPricing=false) → formula", () => {
      const result = formatChargeExplanation("enterprise", 55, 300, 16500, false);
      expect(result).toContain("55");
      expect(result).toContain("€3.00");
      expect(result).toContain("€165.00");
      expect(result).not.toMatch(/contact us/i);
    });
  });

  // ── formatHistoryRate ─────────────────────────────────────────────────────

  describe("formatHistoryRate(tier, amount, rate, isCustomPricing)", () => {
    it("enterprise custom (isCustomPricing=true) → 'Custom'", () => {
      expect(formatHistoryRate("enterprise", 0, 500, true)).toBe("Custom");
    });

    it("MUST NOT return '€0.00' for enterprise custom history rows", () => {
      const result = formatHistoryRate("enterprise", 0, 500, true);
      expect(result).not.toBe("€0.00");
    });

    it("enterprise fixed with rate=0 (isCustomPricing=false) → '€0.00'", () => {
      expect(formatHistoryRate("enterprise", 0, 0, false)).toBe("€0.00");
    });

    it("enterprise per_unit with positive rate (isCustomPricing=false) → '€R.RR'", () => {
      expect(formatHistoryRate("enterprise", 16500, 300, false)).toBe("€3.00");
    });

    it("standard history rows → euro rate", () => {
      expect(formatHistoryRate("standard", 5000, 500, false)).toBe("€5.00");
    });

    it("handles absent isCustomPricing (old records) as non-custom", () => {
      expect(formatHistoryRate("enterprise", 5000, 500)).toBe("€5.00");
      expect(formatHistoryRate("standard", 5000, 500)).toBe("€5.00");
    });

    it("handles null tier as non-enterprise", () => {
      expect(formatHistoryRate(null, 5000, 500, false)).toBe("€5.00");
    });
  });

  // ── formatHistoryAmount ───────────────────────────────────────────────────

  describe("formatHistoryAmount(tier, amount, finalAmount, isCustomPricing)", () => {
    it("enterprise custom (isCustomPricing=true) → 'Custom pricing'", () => {
      expect(formatHistoryAmount("enterprise", 0, null, true)).toBe("Custom pricing");
    });

    it("MUST NOT return '€0.00' for enterprise custom history rows", () => {
      const result = formatHistoryAmount("enterprise", 0, null, true);
      expect(result).not.toBe("€0.00");
      expect(result).not.toContain("€0.00");
    });

    it("enterprise fixed with rate=0 (isCustomPricing=false) → '€0.00'", () => {
      expect(formatHistoryAmount("enterprise", 0, null, false)).toBe("€0.00");
    });

    it("enterprise per_unit with positive amount (isCustomPricing=false) → '€X.XX'", () => {
      expect(formatHistoryAmount("enterprise", 16500, null, false)).toBe("€165.00");
    });

    it("standard finalised → uses finalAmountCents", () => {
      expect(formatHistoryAmount("standard", 5000, 4800, false)).toBe("€48.00");
    });

    it("standard open → falls back to estimatedAmountCents", () => {
      expect(formatHistoryAmount("standard", 5000, null, false)).toBe("€50.00");
    });

    it("enterprise custom even when finalAmountCents is 0 → 'Custom pricing'", () => {
      expect(formatHistoryAmount("enterprise", 0, 0, true)).toBe("Custom pricing");
    });

    it("handles absent isCustomPricing as non-custom", () => {
      expect(formatHistoryAmount("enterprise", 5000, null)).toBe("€50.00");
    });
  });

  // ── Integration — isCustomPricing from API, not inferred ─────────────────

  describe("Explicit field prevents mis-detection at zero amounts", () => {
    it("enterprise/fixed with rate=0: isCustomPricing=false prevents 'Custom pricing'", () => {
      // Old inference: enterprise + 0 → custom (WRONG for fixed/per_unit with rate=0)
      // New: isCustomPricing=false from API → show €0.00 (CORRECT)
      expect(formatEstimatedCharge("enterprise", 0, false)).toBe("€0.00");
      expect(formatEstimatedCharge("enterprise", 0, false)).not.toBe("Custom pricing");
    });

    it("enterprise/per_unit with rate=0: isCustomPricing=false → '€0.00'", () => {
      expect(formatEstimatedCharge("enterprise", 0, false)).toBe("€0.00");
    });

    it("enterprise/custom with estimate=0: isCustomPricing=true → 'Custom pricing'", () => {
      expect(formatEstimatedCharge("enterprise", 0, true)).toBe("Custom pricing");
    });

    it("50 apartments on standard plan: isCustomPricing=false → never 'Custom pricing'", () => {
      expect(formatEstimatedCharge("standard", 0, false)).not.toBe("Custom pricing");
      expect(isEnterpriseCustom(false)).toBe(false);
    });

    it("2 apartments with enterprise custom override: isCustomPricing=true → 'Custom pricing'", () => {
      expect(formatEstimatedCharge("enterprise", 0, true)).toBe("Custom pricing");
      expect(isEnterpriseCustom(true)).toBe(true);
    });

    it("enterprise/per_unit positive amount: isCustomPricing=false → real amount displayed", () => {
      expect(formatEstimatedCharge("enterprise", 15000, false)).toBe("€150.00");
      expect(isEnterpriseCustom(false)).toBe(false);
    });
  });
});
