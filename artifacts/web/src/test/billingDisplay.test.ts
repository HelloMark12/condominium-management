/**
 * Test Suite 36b — Enterprise custom pricing display (L3 fix)
 *
 * Proves that:
 *  - Enterprise custom pricing NEVER renders "€0.00"
 *  - The detection is driven by currentPlan + estimatedAmountCents (both set by DB config),
 *    NOT by a hardcoded apartment count threshold.
 *  - Standard, free, and enterprise/per_unit plans still show numeric amounts.
 *  - History table rows for enterprise custom show "Custom pricing", not "€0.00".
 */

import { describe, it, expect } from "vitest";
import {
  isEnterpriseCustom,
  formatEstimatedCharge,
  formatChargeExplanation,
  formatHistoryRate,
  formatHistoryAmount,
} from "@/lib/billingDisplay";

describe("Suite 36b — Enterprise custom pricing display (L3)", () => {

  // ── isEnterpriseCustom ────────────────────────────────────────────────────

  describe("isEnterpriseCustom()", () => {
    it("returns true for enterprise plan with 0 estimatedAmountCents", () => {
      expect(isEnterpriseCustom("enterprise", 0)).toBe(true);
    });

    it("returns true for enterprise plan with null estimatedAmountCents", () => {
      expect(isEnterpriseCustom("enterprise", null)).toBe(true);
    });

    it("returns true for enterprise plan with undefined estimatedAmountCents", () => {
      expect(isEnterpriseCustom("enterprise", undefined)).toBe(true);
    });

    it("returns false for enterprise plan with non-zero amount (per_unit or fixed behavior)", () => {
      expect(isEnterpriseCustom("enterprise", 50000)).toBe(false);
    });

    it("returns false for standard plan even with 0 amount", () => {
      // A standard company with 0 apartments should NOT trigger enterprise custom display
      expect(isEnterpriseCustom("standard", 0)).toBe(false);
    });

    it("returns false for free plan", () => {
      expect(isEnterpriseCustom("free", 0)).toBe(false);
    });

    it("is not driven by a hardcoded apartment threshold — plan must be 'enterprise'", () => {
      // Even with 1000 apartments, if the plan is 'standard', this returns false
      expect(isEnterpriseCustom("standard", 0)).toBe(false);
      // Only 'enterprise' + 0 amount triggers the custom display
      expect(isEnterpriseCustom("enterprise", 0)).toBe(true);
    });
  });

  // ── formatEstimatedCharge — the critical "no €0.00" assertion ─────────────

  describe("formatEstimatedCharge()", () => {
    it("MUST NOT return '€0.00' for enterprise custom pricing", () => {
      const result = formatEstimatedCharge("enterprise", 0);
      expect(result).not.toBe("€0.00");
      expect(result).not.toContain("€0.00");
    });

    it("returns 'Custom pricing' for enterprise with 0 estimatedAmountCents", () => {
      expect(formatEstimatedCharge("enterprise", 0)).toBe("Custom pricing");
    });

    it("returns 'Custom pricing' for enterprise with null estimatedAmountCents", () => {
      expect(formatEstimatedCharge("enterprise", null)).toBe("Custom pricing");
    });

    it("returns a euro amount for enterprise with per_unit or fixed behavior (non-zero)", () => {
      const result = formatEstimatedCharge("enterprise", 50000);
      expect(result).toBe("€500.00");
      expect(result).not.toBe("Custom pricing");
    });

    it("returns '€0.00 (Free)' for free plan", () => {
      expect(formatEstimatedCharge("free", 0)).toBe("€0.00 (Free)");
    });

    it("returns correct euro amount for standard plan", () => {
      expect(formatEstimatedCharge("standard", 5000)).toBe("€50.00");
    });

    it("returns '€50.00' not '€0.00' for standard plan with 10 units at €5", () => {
      const result = formatEstimatedCharge("standard", 5000);
      expect(result).toBe("€50.00");
      expect(result).not.toBe("€0.00");
    });
  });

  // ── formatChargeExplanation ───────────────────────────────────────────────

  describe("formatChargeExplanation()", () => {
    it("MUST NOT contain '€0.00' for enterprise custom pricing", () => {
      const result = formatChargeExplanation("enterprise", 60, 500, 0);
      expect(result).not.toContain("€0.00");
    });

    it("returns contact-us message for enterprise custom", () => {
      const result = formatChargeExplanation("enterprise", 60, 500, 0);
      expect(result).toMatch(/contact us/i);
      expect(result).toMatch(/custom rate/i);
    });

    it("returns free plan message for free tier", () => {
      const result = formatChargeExplanation("free", 1, 0, 0);
      expect(result).toMatch(/free plan/i);
      expect(result).toMatch(/no charge/i);
    });

    it("returns formula for standard plan", () => {
      const result = formatChargeExplanation("standard", 10, 500, 5000);
      expect(result).toContain("10");
      expect(result).toContain("€5.00");
      expect(result).toContain("€50.00");
    });

    it("returns formula for enterprise with non-zero amount (per_unit behavior)", () => {
      const result = formatChargeExplanation("enterprise", 55, 300, 16500);
      expect(result).toContain("55");
      expect(result).toContain("€3.00");
      expect(result).toContain("€165.00");
      expect(result).not.toMatch(/contact us/i);
    });
  });

  // ── formatHistoryRate ─────────────────────────────────────────────────────

  describe("formatHistoryRate()", () => {
    it("MUST NOT return '€0.00' for enterprise custom history rows", () => {
      const result = formatHistoryRate("enterprise", 0, 500);
      expect(result).not.toBe("€0.00");
    });

    it("returns 'Custom' for enterprise custom history rows", () => {
      expect(formatHistoryRate("enterprise", 0, 500)).toBe("Custom");
    });

    it("returns euro rate for standard history rows", () => {
      expect(formatHistoryRate("standard", 5000, 500)).toBe("€5.00");
    });

    it("returns euro rate for enterprise with non-zero amount", () => {
      expect(formatHistoryRate("enterprise", 16500, 300)).toBe("€3.00");
    });

    it("handles null/undefined tier as non-enterprise", () => {
      expect(formatHistoryRate(null, 5000, 500)).toBe("€5.00");
      expect(formatHistoryRate(undefined, 5000, 500)).toBe("€5.00");
    });
  });

  // ── formatHistoryAmount ───────────────────────────────────────────────────

  describe("formatHistoryAmount()", () => {
    it("MUST NOT return '€0.00' for enterprise custom history rows", () => {
      const result = formatHistoryAmount("enterprise", 0, null);
      expect(result).not.toBe("€0.00");
      expect(result).not.toContain("€0.00");
    });

    it("returns 'Custom pricing' for enterprise custom history rows", () => {
      expect(formatHistoryAmount("enterprise", 0, null)).toBe("Custom pricing");
    });

    it("returns finalAmountCents when finalised for standard", () => {
      expect(formatHistoryAmount("standard", 5000, 4800)).toBe("€48.00");
    });

    it("falls back to estimatedAmountCents when not finalised for standard", () => {
      expect(formatHistoryAmount("standard", 5000, null)).toBe("€50.00");
    });

    it("returns 'Custom pricing' for enterprise custom even when finalised", () => {
      // Even if someone sets finalAmountCents on a custom enterprise record, show custom message
      // because 0 estimated still signals custom pricing
      expect(formatHistoryAmount("enterprise", 0, 0)).toBe("Custom pricing");
    });
  });

  // ── Integration — detection driven by plan, not unit count ───────────────

  describe("Detection is driven by DB-derived plan, not hardcoded threshold", () => {
    it("50 apartments on standard plan: NOT treated as enterprise custom", () => {
      // If the DB config has enterpriseStart=100, a company with 50 units is 'standard'
      // The UI must NOT show 'Custom pricing' just because unit count is high
      expect(isEnterpriseCustom("standard", 0)).toBe(false);
      expect(formatEstimatedCharge("standard", 0)).not.toBe("Custom pricing");
    });

    it("2 apartments on enterprise plan (custom override): IS treated as enterprise custom", () => {
      // A company can have a custom billing override putting them on enterprise
      // even with a low unit count — the plan is 'enterprise' from the DB
      expect(isEnterpriseCustom("enterprise", 0)).toBe(true);
      expect(formatEstimatedCharge("enterprise", 0)).toBe("Custom pricing");
    });

    it("enterprise plan with per_unit behavior shows real amount, not custom pricing", () => {
      // When enterprisePricingBehavior='per_unit', the API calculates and returns a real amount
      expect(isEnterpriseCustom("enterprise", 15000)).toBe(false);
      expect(formatEstimatedCharge("enterprise", 15000)).toBe("€150.00");
    });
  });
});
