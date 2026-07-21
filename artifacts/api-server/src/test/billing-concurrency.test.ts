/**
 * Suite 41 — Billing activeUnitCount concurrency (Correction 6)
 *
 * Verifies that concurrent apartment create / archive / restore operations
 * leave monthly_usage_records.active_unit_count equal to the actual
 * number of active apartments in the database.
 *
 * Without the advisory-lock fix, TOCTOU races cause two concurrent creates
 * to both read count = N and then both write N+1, leaving the stored count
 * one less than the real value.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createTestUser,
  createTestCompany,
  createTestBuilding,
  cleanupTestData,
  uid,
} from "./setup";
import {
  db,
  unitsTable,
  monthlyUsageRecordsTable,
} from "@workspace/db";
import { and, count, eq } from "drizzle-orm";

const AUTH = (clerkId: string) => ({ "x-test-clerk-user-id": clerkId });

// ── Test fixtures ──────────────────────────────────────────────────────────────

let companyId: string;
let buildingId: string;
let adminClerkId: string;
const createdCompanyIds: string[] = [];

beforeAll(async () => {
  adminClerkId = `test_conc_${uid()}`;
  const adminUser = await createTestUser({ clerkUserId: adminClerkId });
  const company = await createTestCompany({
    name: `Concurrency Co ${uid()}`,
    adminUserId: adminUser.id,
  });
  companyId = company.id;
  createdCompanyIds.push(companyId);

  const building = await createTestBuilding(companyId);
  buildingId = building.id;
});

afterAll(async () => {
  await cleanupTestData(createdCompanyIds);
});

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function realActiveCount(): Promise<number> {
  const [result] = await db
    .select({ n: count() })
    .from(unitsTable)
    .where(
      and(
        eq(unitsTable.companyId, companyId),
        eq(unitsTable.status, "active"),
        eq(unitsTable.unitType, "apartment"),
      ),
    );
  return Number(result?.n ?? 0);
}

async function storedActiveCount(): Promise<number | null> {
  // Billing month in YYYY-MM-01 format (matches getCurrentBillingMonth())
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Malta", // BILLING_TIMEZONE
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const billingMonth = `${year}-${month}-01`;
  const [record] = await db
    .select({ activeUnitCount: monthlyUsageRecordsTable.activeUnitCount })
    .from(monthlyUsageRecordsTable)
    .where(
      and(
        eq(monthlyUsageRecordsTable.companyId, companyId),
        eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
      ),
    )
    .limit(1);
  return record?.activeUnitCount ?? null;
}

async function createUnit(): Promise<string> {
  const res = await request(app)
    .post(`/api/buildings/${buildingId}/units`)
    .set(AUTH(adminClerkId))
    .send({ unitNumber: `Conc-${uid()}`, unitType: "apartment" });
  if (res.status !== 201) {
    throw new Error(`Create unit failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function archiveUnit(unitId: string): Promise<void> {
  const res = await request(app)
    .post(`/api/units/${unitId}/archive`)
    .set(AUTH(adminClerkId));
  if (res.status !== 200) {
    throw new Error(`Archive unit failed: ${res.status}`);
  }
}

async function restoreUnit(unitId: string): Promise<void> {
  const res = await request(app)
    .post(`/api/units/${unitId}/restore`)
    .set(AUTH(adminClerkId));
  if (res.status !== 200) {
    throw new Error(`Restore unit failed: ${res.status}`);
  }
}

// ── Suite 41 ───────────────────────────────────────────────────────────────────

describe("Suite 41 — Billing activeUnitCount concurrency", () => {
  it("5 parallel apartment creates → storedActiveCount equals realActiveCount", async () => {
    const before = await realActiveCount();

    // Fire 5 concurrent create requests
    const unitIds = await Promise.all([1, 2, 3, 4, 5].map(() => createUnit()));
    expect(unitIds).toHaveLength(5);

    const real = await realActiveCount();
    const stored = await storedActiveCount();

    expect(real).toBe(before + 5);
    expect(stored).toBe(real);
  }, 30_000);

  it("Repeated run: 5 more parallel creates → count remains accurate", async () => {
    const before = await realActiveCount();
    const stored0 = await storedActiveCount();

    await Promise.all([1, 2, 3, 4, 5].map(() => createUnit()));

    const real = await realActiveCount();
    const stored = await storedActiveCount();

    expect(real).toBe(before + 5);
    expect(stored).toBe(real);
  }, 30_000);

  it("Parallel create and archive → count is consistent", async () => {
    // Pre-create some units to archive
    const toArchive = await Promise.all([1, 2, 3].map(() => createUnit()));
    const beforeReal = await realActiveCount();

    // Concurrently create 3 new + archive 3 existing
    await Promise.all([
      createUnit(),
      createUnit(),
      createUnit(),
      archiveUnit(toArchive[0]!),
      archiveUnit(toArchive[1]!),
      archiveUnit(toArchive[2]!),
    ]);

    const real = await realActiveCount();
    const stored = await storedActiveCount();

    // Net change: +3 created -3 archived = 0
    expect(real).toBe(beforeReal);
    expect(stored).toBe(real);
  }, 30_000);

  it("Parallel restore operations → count is consistent", async () => {
    // Archive some units first (serially to get known state)
    const units = await Promise.all([1, 2, 3].map(() => createUnit()));
    for (const id of units) {
      await archiveUnit(id);
    }

    const beforeReal = await realActiveCount();

    // Restore all three in parallel
    await Promise.all(units.map((id) => restoreUnit(id)));

    const real = await realActiveCount();
    const stored = await storedActiveCount();

    expect(real).toBe(beforeReal + 3);
    expect(stored).toBe(real);
  }, 30_000);

  it("storedActiveCount always equals realActiveCount after all operations", async () => {
    const real = await realActiveCount();
    const stored = await storedActiveCount();
    expect(stored).toBe(real);
  });
});
