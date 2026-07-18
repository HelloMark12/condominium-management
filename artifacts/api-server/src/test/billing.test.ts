/**
 * Test Suite 25 — Pricing/billing calculations
 * Test Suite 26 — Timezone / Malta billing month
 * Test Suite 32 — Configurable billing (DB-driven, no hardcoded constants)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pricingConfigsTable, companyPricingOverridesTable, companiesTable, companyMembershipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getActivePricingConfig,
  getCompanyPricingOverride,
  calculateTier,
  calculateEstimatedAmountCents,
  getCurrentBillingMonth,
  formatEuroCents,
  BILLING_TIMEZONE,
} from "../lib/billing";
import {
  createTestUser,
  createTestCompany,
  ensurePricingConfig,
  cleanupTestData,
  uid,
} from "./setup";

// ── Suite 25: Billing calculations ──────────────────────────────────────────

describe("Suite 25 — Billing calculations", () => {
  const mockConfig = {
    freeUnitLimit: 2,
    standardMin: 3,
    standardMax: 49,
    enterpriseStart: 50,
    ratePerUnitCents: 500,
    enterprisePricingBehavior: "custom" as const,
    enterpriseFixedRateCents: null,
    enterprisePerUnitRateCents: null,
    currency: "EUR",
  } as Parameters<typeof calculateTier>[1];

  describe("calculateTier", () => {
    it("returns free for 0 apartments", () => {
      expect(calculateTier(0, mockConfig)).toBe("free");
    });
    it("returns free for exactly freeUnitLimit apartments", () => {
      expect(calculateTier(2, mockConfig)).toBe("free");
    });
    it("returns standard for freeUnitLimit + 1 apartments", () => {
      expect(calculateTier(3, mockConfig)).toBe("standard");
    });
    it("returns standard for standardMax apartments", () => {
      expect(calculateTier(49, mockConfig)).toBe("standard");
    });
    it("returns enterprise for enterpriseStart apartments", () => {
      expect(calculateTier(50, mockConfig)).toBe("enterprise");
    });
    it("returns enterprise for > enterpriseStart apartments", () => {
      expect(calculateTier(100, mockConfig)).toBe("enterprise");
    });
  });

  describe("calculateEstimatedAmountCents", () => {
    it("returns 0 for free tier", () => {
      expect(calculateEstimatedAmountCents(2, mockConfig)).toBe(0);
    });
    it("returns 0 for 0 apartments", () => {
      expect(calculateEstimatedAmountCents(0, mockConfig)).toBe(0);
    });
    it("returns peak × rate for standard tier", () => {
      expect(calculateEstimatedAmountCents(10, mockConfig)).toBe(5000); // 10 × €5 = €50
    });
    it("returns 0 for enterprise with custom behavior", () => {
      expect(calculateEstimatedAmountCents(50, mockConfig)).toBe(0);
    });
    it("calculates fixed fee for enterprise/fixed", () => {
      const fixed = { ...mockConfig, enterprisePricingBehavior: "fixed" as const, enterpriseFixedRateCents: 100000 };
      expect(calculateEstimatedAmountCents(50, fixed)).toBe(100000);
    });
    it("calculates per_unit for enterprise/per_unit", () => {
      const perUnit = { ...mockConfig, enterprisePricingBehavior: "per_unit" as const, enterprisePerUnitRateCents: 300 };
      expect(calculateEstimatedAmountCents(50, perUnit)).toBe(15000); // 50 × €3
    });
  });

  describe("Override logic", () => {
    it("uses override freeUnitLimit when provided", () => {
      const override = { customFreeUnitLimit: 5 } as Parameters<typeof calculateTier>[2];
      expect(calculateTier(3, mockConfig, override)).toBe("free");
      expect(calculateTier(6, mockConfig, override)).toBe("standard");
    });
    it("uses override ratePerUnitCents for standard tier amount", () => {
      const override = { customRatePerUnitCents: 1000 } as Parameters<typeof calculateEstimatedAmountCents>[2];
      expect(calculateEstimatedAmountCents(10, mockConfig, override)).toBe(10000); // 10 × €10
    });
    it("uses fixedMonthlyFeeCents for standard tier when set", () => {
      const override = { fixedMonthlyFeeCents: 20000 } as Parameters<typeof calculateEstimatedAmountCents>[2];
      expect(calculateEstimatedAmountCents(10, mockConfig, override)).toBe(20000);
    });
    it("null override falls back to platform config", () => {
      expect(calculateTier(10, mockConfig, null)).toBe("standard");
    });
    it("undefined override falls back to platform config", () => {
      expect(calculateTier(10, mockConfig, undefined)).toBe("standard");
    });
  });

  describe("formatEuroCents", () => {
    it("formats 0 as €0.00", () => {
      expect(formatEuroCents(0)).toBe("€0.00");
    });
    it("formats 500 as €5.00", () => {
      expect(formatEuroCents(500)).toBe("€5.00");
    });
    it("formats 100000 as €1000.00", () => {
      expect(formatEuroCents(100000)).toBe("€1000.00");
    });
  });
});

// ── Suite 26: Timezone / Malta billing month ─────────────────────────────────

describe("Suite 26 — Malta billing month", () => {
  it("BILLING_TIMEZONE is Europe/Malta", () => {
    expect(BILLING_TIMEZONE).toBe("Europe/Malta");
  });

  it("getCurrentBillingMonth returns YYYY-MM-01 format", () => {
    const month = getCurrentBillingMonth();
    expect(month).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("billing month day is always 01", () => {
    const month = getCurrentBillingMonth();
    expect(month.slice(-2)).toBe("01");
  });

  it("billing month is within a plausible range", () => {
    const month = getCurrentBillingMonth();
    const year = parseInt(month.slice(0, 4));
    expect(year).toBeGreaterThanOrEqual(2025);
    expect(year).toBeLessThanOrEqual(2030);
  });
});

// ── Suite 32: Configurable billing (DB-driven) ───────────────────────────────

describe("Suite 32 — Configurable billing from DB", () => {
  let configId: string;

  beforeAll(async () => {
    const config = await ensurePricingConfig();
    configId = config.id;
  });

  it("getActivePricingConfig returns a config for current month", async () => {
    const billingMonth = getCurrentBillingMonth();
    const config = await getActivePricingConfig(billingMonth);
    expect(config).toBeDefined();
    expect(config.status).toBe("active");
    expect(config.freeUnitLimit).toBeGreaterThanOrEqual(0);
    expect(config.ratePerUnitCents).toBeGreaterThan(0);
  });

  it("getActivePricingConfig throws for a month with no config", async () => {
    await expect(getActivePricingConfig("1990-01-01")).rejects.toThrow(
      /No active pricing configuration/,
    );
  });

  it("getCompanyPricingOverride returns null for unknown company", async () => {
    const override = await getCompanyPricingOverride(
      "00000000-0000-0000-0000-000000000000",
      getCurrentBillingMonth(),
    );
    expect(override).toBeNull();
  });

  it("config has all required fields", async () => {
    const config = await getActivePricingConfig(getCurrentBillingMonth());
    expect(config.freeUnitLimit).toBeDefined();
    expect(config.standardMin).toBeDefined();
    expect(config.standardMax).toBeDefined();
    expect(config.enterpriseStart).toBeDefined();
    expect(config.ratePerUnitCents).toBeDefined();
    expect(config.currency).toBe("EUR");
  });

  it("no hardcoded FREE_UNIT_LIMIT export in billing module", async () => {
    // Dynamic import to check named exports
    const billingModule = await import("../lib/billing");
    expect((billingModule as Record<string, unknown>)["FREE_UNIT_LIMIT"]).toBeUndefined();
    expect((billingModule as Record<string, unknown>)["STANDARD_MAX_UNITS"]).toBeUndefined();
    expect((billingModule as Record<string, unknown>)["DEFAULT_RATE_PER_UNIT_CENTS"]).toBeUndefined();
  });

  it("billing tier boundary uses DB config, not hardcoded values", async () => {
    const config = await getActivePricingConfig(getCurrentBillingMonth());
    // At exactly freeUnitLimit → free
    expect(calculateTier(config.freeUnitLimit, config)).toBe("free");
    // At freeUnitLimit+1 → standard (or enterprise if enterpriseStart = freeUnitLimit+1)
    const oneAboveFree = config.freeUnitLimit + 1;
    const expected = oneAboveFree >= config.enterpriseStart ? "enterprise" : "standard";
    expect(calculateTier(oneAboveFree, config)).toBe(expected);
  });
});
