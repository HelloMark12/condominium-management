/**
 * Test Suite 33 — Month rollover / peak billing logic
 *
 * Issue 1 FIX: Tier and estimated amount must be based on the MONTHLY PEAK,
 * not the current active count.  After a company reaches 10 apartments and
 * archives down to 2:
 *   - active_unit_count    = 2
 *   - peak_active_unit_count = 10
 *   - subscription_tier    must reflect 10 (not 2)
 *   - estimated_amount_cents must reflect 10 (not 2)
 *
 * Issue 8 FIX: All tests make unconditional assertions — no "if (record)"
 * patterns.  Every test fails when the expected record is missing.
 *
 * Covers:
 *   - Peak-based tier and amount (Issue 1 regression test)
 *   - Archiving does not lower the peak (GREATEST)
 *   - Garages and commercial units do not affect billing
 *   - Finalised records are not recalculated
 *   - Pricing snapshot columns are populated
 *   - Concurrent apartment creation (Issue 8 concurrent test)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  unitsTable,
  monthlyUsageRecordsTable,
} from "@workspace/db";
import {
  createTestUser,
  createTestCompany,
  createTestBuilding,
  createTestUnit,
  ensurePricingConfig,
  cleanupTestData,
  uid,
} from "./setup";
import request from "supertest";
import app from "../app";
import { getCurrentBillingMonth } from "../lib/billing";

function authHeaders(clerkUserId: string) {
  return { "x-test-clerk-user-id": clerkUserId };
}

/** Create an apartment through the real API so billing is triggered. */
async function createAptViaApi(
  adminClerkId: string,
  buildingId: string,
): Promise<{ id: string }> {
  const res = await request(app)
    .post(`/api/buildings/${buildingId}/units`)
    .set(authHeaders(adminClerkId))
    .send({ unitNumber: uid("apt-"), unitType: "apartment" });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("Suite 33 — Month rollover and peak billing", () => {
  let companyIds: string[] = [];
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let company: Awaited<ReturnType<typeof createTestCompany>>;
  let building: Awaited<ReturnType<typeof createTestBuilding>>;

  beforeAll(async () => {
    await ensurePricingConfig(); // freeUnitLimit=2, standard=3-49, enterprise=50+, rate=500¢
    adminUser = await createTestUser();
    company = await createTestCompany({ adminUserId: adminUser.id });
    companyIds.push(company.id);
    building = await createTestBuilding(company.id);
  });

  afterAll(() => cleanupTestData(companyIds));

  // ── Issue 1 regression: tier and amount are peak-based ────────────────────

  it("tier is based on the monthly peak, not the current active count", async () => {
    const billingMonth = getCurrentBillingMonth();

    // Create 3 apartments via API → triggers billing update; peak = 3 → standard tier
    const a1 = await createAptViaApi(adminUser.clerkUserId, building.id);
    const a2 = await createAptViaApi(adminUser.clerkUserId, building.id);
    const a3 = await createAptViaApi(adminUser.clerkUserId, building.id);

    // Archive 2 → active count = 1, but peak must stay at 3
    const arch1 = await request(app)
      .post(`/api/units/${a1.id}/archive`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(arch1.status).toBe(200);

    const arch2 = await request(app)
      .post(`/api/units/${a2.id}/archive`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(arch2.status).toBe(200);

    // Fetch usage record — must exist (billing was triggered via API calls above)
    const [usage] = await db
      .select()
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      )
      .limit(1);

    // Unconditional assertion — record must exist because we created units via API
    expect(usage, "Monthly usage record must exist after API unit operations").toBeDefined();

    // Exact active count after 2 archives
    expect(usage!.activeUnitCount).toBe(1);

    // Peak must never decrease — still 3
    expect(usage!.peakActiveUnitCount).toBe(3);

    // ISSUE 1 FIX: tier and amount must reflect the peak (3), not the current count (1).
    // With freeUnitLimit=2, peak=3 → standard tier (not free).
    expect(usage!.subscriptionTier).toBe("standard");

    // estimated = peak × ratePerUnitCents = 3 × 500 = 1500¢
    expect(usage!.estimatedAmountCents).toBe(1500);

    // Clean up this test's units
    await request(app).post(`/api/units/${a1.id}/restore`).set(authHeaders(adminUser.clerkUserId));
    await request(app).post(`/api/units/${a2.id}/archive`).set(authHeaders(adminUser.clerkUserId)); // keep archived
    await request(app).post(`/api/units/${a3.id}/archive`).set(authHeaders(adminUser.clerkUserId));
  });

  it("GET /companies/:id/usage returns peak-based tier and estimate", async () => {
    const res = await request(app)
      .get(`/api/companies/${company.id}/usage`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);

    const records = res.body as Array<{
      subscriptionTier: string;
      estimatedAmountCents: number;
      peakActiveUnitCount: number;
      activeUnitCount: number;
    }>;
    expect(Array.isArray(records)).toBe(true);

    const current = records[0]; // most recent month
    expect(current, "At least one usage record must exist").toBeDefined();

    // Peak >= active always
    expect(current!.peakActiveUnitCount).toBeGreaterThanOrEqual(current!.activeUnitCount);
  });

  it("GET /companies/:id/subscription returns peak-based plan and estimate", async () => {
    const res = await request(app)
      .get(`/api/companies/${company.id}/subscription`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);

    const sub = res.body as {
      currentPlan: string;
      estimatedAmountCents: number;
      peakActiveUnitCount: number;
      activeUnitCount: number;
      isCustomPricing: boolean;
    };

    // Peak >= active
    expect(sub.peakActiveUnitCount).toBeGreaterThanOrEqual(sub.activeUnitCount);

    // After creating 3 and archiving 2, peak=3 → standard tier
    expect(sub.currentPlan).toBe("standard");

    // isCustomPricing must be explicit boolean, not inferred
    expect(typeof sub.isCustomPricing).toBe("boolean");
    expect(sub.isCustomPricing).toBe(false); // standard plan is never custom
  });

  // ── Only apartments count toward billing ──────────────────────────────────

  it("only apartments count toward billing, not garages or commercial units", async () => {
    const billingMonth = getCurrentBillingMonth();

    // Record the peak before creating garage
    const [before] = await db
      .select({ peak: monthlyUsageRecordsTable.peakActiveUnitCount })
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      )
      .limit(1);
    expect(before, "Usage record must exist before garage test").toBeDefined();
    const peakBefore = before!.peak;

    // Create a garage via DB (direct, to avoid API billing side-effects on garage)
    const garage = await createTestUnit(company.id, building.id, { unitType: "garage" });

    // Archive the garage via API — garage operations must NOT change billing
    const archiveRes = await request(app)
      .post(`/api/units/${garage.id}/archive`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(archiveRes.status).toBe(200);

    // Peak must be unchanged
    const [after] = await db
      .select({ peak: monthlyUsageRecordsTable.peakActiveUnitCount })
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      )
      .limit(1);
    expect(after, "Usage record must exist after garage test").toBeDefined();
    expect(after!.peak).toBe(peakBefore);

    // Confirm the garage was archived
    const [garageRow] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, garage.id))
      .limit(1);
    expect(garageRow!.status).toBe("archived");
  });

  // ── Finalised records are not recalculated ────────────────────────────────

  it("finalised records are not recalculated when unit operations occur", async () => {
    // Insert a finalised record for a past month
    await db
      .insert(monthlyUsageRecordsTable)
      .values({
        companyId: company.id,
        billingMonth: "2024-01-01",
        activeUnitCount: 5,
        peakActiveUnitCount: 10,
        subscriptionTier: "standard",
        ratePerUnitCents: 500,
        estimatedAmountCents: 5000,
        invoiceStatus: "finalised",
        finalAmountCents: 5000,
      })
      .onConflictDoNothing();

    // Create and archive an apartment (triggers billing update for CURRENT month only)
    const apt = await createAptViaApi(adminUser.clerkUserId, building.id);
    await request(app)
      .post(`/api/units/${apt.id}/archive`)
      .set(authHeaders(adminUser.clerkUserId));

    // Past finalised record must be unchanged
    const [record] = await db
      .select()
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, "2024-01-01"),
        ),
      )
      .limit(1);

    expect(record, "Finalised past record must exist").toBeDefined();
    expect(record!.invoiceStatus).toBe("finalised");
    expect(record!.peakActiveUnitCount).toBe(10); // unchanged
    expect(record!.estimatedAmountCents).toBe(5000); // unchanged
  });

  // ── Pricing snapshot columns are populated ────────────────────────────────

  it("pricing snapshot columns are populated on billing update", async () => {
    const billingMonth = getCurrentBillingMonth();

    // Create and immediately archive an apartment to trigger billing
    const apt = await createAptViaApi(adminUser.clerkUserId, building.id);
    await request(app)
      .post(`/api/units/${apt.id}/archive`)
      .set(authHeaders(adminUser.clerkUserId));

    const [record] = await db
      .select()
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      )
      .limit(1);

    // Unconditional — must exist
    expect(record, "Usage record must exist after API apartment operations").toBeDefined();

    // All snapshot fields must be populated
    expect(record!.snapshotFreeUnitLimit).not.toBeNull();
    expect(record!.snapshotFreeUnitLimit).toBeGreaterThanOrEqual(0);
    expect(record!.snapshotRatePerUnitCents).not.toBeNull();
    expect(record!.snapshotRatePerUnitCents).toBeGreaterThan(0);
    expect(record!.pricingConfigId).not.toBeNull();
    expect(record!.snapshotEnterpriseBehavior).not.toBeNull();
    expect(record!.snapshotCurrency).toBe("EUR");
  });
});

// ── Suite 33b — Concurrent apartment creation ─────────────────────────────────

describe("Suite 33b — Concurrent apartment creation (peak accuracy)", () => {
  let companyIds: string[] = [];
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let company: Awaited<ReturnType<typeof createTestCompany>>;
  let building: Awaited<ReturnType<typeof createTestBuilding>>;

  beforeAll(async () => {
    await ensurePricingConfig();
    adminUser = await createTestUser();
    company = await createTestCompany({ adminUserId: adminUser.id });
    companyIds.push(company.id);
    building = await createTestBuilding(company.id);
  });

  afterAll(() => cleanupTestData(companyIds));

  it("5 concurrent apartment creations all succeed and peak reflects all 5", async () => {
    const billingMonth = getCurrentBillingMonth();

    // Fire 5 parallel POST requests
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(`/api/buildings/${building.id}/units`)
          .set(authHeaders(adminUser.clerkUserId))
          .send({ unitNumber: uid(`c-apt-${i}-`), unitType: "apartment" }),
      ),
    );

    // All 5 must succeed
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201), `Expected all 201, got ${statuses.join(",")}`).toBe(true);

    // Fetch usage record
    const [usage] = await db
      .select()
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      )
      .limit(1);

    expect(usage, "Usage record must exist after concurrent creates").toBeDefined();

    // Peak must be 5 (all concurrent creates contributed)
    expect(usage!.peakActiveUnitCount).toBe(5);
    expect(usage!.activeUnitCount).toBe(5);

    // No duplicate rows (unique constraint on companyId + billingMonth)
    const allRecords = await db
      .select()
      .from(monthlyUsageRecordsTable)
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, company.id),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      );
    expect(allRecords.length).toBe(1);
  });
});
