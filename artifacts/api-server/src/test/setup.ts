/**
 * Test setup helpers for API server integration tests.
 *
 * Strategy: each test suite creates its own fixtures, then cleans up
 * by deleting rows in FK-safe order after the suite completes.
 * We do NOT use transactions for rollback because the Express app
 * runs in the same process but Supertest fires real HTTP requests
 * that use the shared pool.
 */

import { randomBytes } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  companiesTable,
  companyMembershipsTable,
  buildingsTable,
  unitsTable,
  unitMembershipsTable,
  monthlyUsageRecordsTable,
  pricingConfigsTable,
} from "@workspace/db";

// ── Unique ID helpers ────────────────────────────────────────────────────────

export function uid(prefix = ""): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

// ── User fixtures ────────────────────────────────────────────────────────────

export async function createTestUser(overrides: Partial<{
  clerkUserId: string;
  email: string;
  fullName: string;
}> = {}) {
  const clerkUserId = overrides.clerkUserId ?? `test_${uid()}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      clerkUserId,
      email: overrides.email ?? `${uid()}@test.example`,
      fullName: overrides.fullName ?? "Test User",
    })
    .returning();
  return user!;
}

// ── Company fixtures ─────────────────────────────────────────────────────────

export async function createTestCompany(overrides: Partial<{
  name: string;
  adminUserId: string;
}> = {}) {
  const name = overrides.name ?? `Company ${uid()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [company] = await db
    .insert(companiesTable)
    .values({ name, slug })
    .returning();

  if (overrides.adminUserId) {
    await db.insert(companyMembershipsTable).values({
      companyId: company!.id,
      userId: overrides.adminUserId,
      role: "administrator",
    });
  }
  return company!;
}

// ── Building fixtures ────────────────────────────────────────────────────────

export async function createTestBuilding(companyId: string, overrides: Partial<{
  name: string;
}> = {}) {
  const [building] = await db
    .insert(buildingsTable)
    .values({
      companyId,
      name: overrides.name ?? `Building ${uid()}`,
      locality: "Valletta",
    })
    .returning();
  return building!;
}

// ── Unit fixtures ────────────────────────────────────────────────────────────

export async function createTestUnit(companyId: string, buildingId: string, overrides: Partial<{
  unitNumber: string;
  unitType: "apartment" | "garage" | "commercial" | "other";
  status: "active" | "archived";
}> = {}) {
  const [unit] = await db
    .insert(unitsTable)
    .values({
      companyId,
      buildingId,
      unitNumber: overrides.unitNumber ?? uid("apt-"),
      unitType: overrides.unitType ?? "apartment",
      status: overrides.status ?? "active",
      activatedAt: new Date(),
    })
    .returning();
  return unit!;
}

// ── Pricing config fixture ────────────────────────────────────────────────────

export async function ensurePricingConfig() {
  const existing = await db
    .select()
    .from(pricingConfigsTable)
    .where(eq(pricingConfigsTable.status, "active"))
    .limit(1);
  if (existing[0]) return existing[0];

  const [config] = await db
    .insert(pricingConfigsTable)
    .values({
      name: "Test Config",
      freeUnitLimit: 2,
      standardMin: 3,
      standardMax: 49,
      enterpriseStart: 50,
      ratePerUnitCents: 500,
      enterprisePricingBehavior: "custom",
      currency: "EUR",
      effectiveFrom: "2020-01-01",
      status: "active",
    })
    .returning();
  return config!;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupTestData(companyIds: string[]) {
  if (companyIds.length === 0) return;
  await db.delete(monthlyUsageRecordsTable).where(
    inArray(monthlyUsageRecordsTable.companyId, companyIds),
  );
  await db.delete(unitMembershipsTable).where(
    inArray(unitMembershipsTable.companyId, companyIds),
  );
  await db.delete(unitsTable).where(
    inArray(unitsTable.companyId, companyIds),
  );
  await db.delete(buildingsTable).where(
    inArray(buildingsTable.companyId, companyIds),
  );
  await db.delete(companyMembershipsTable).where(
    inArray(companyMembershipsTable.companyId, companyIds),
  );
  await db.delete(companiesTable).where(
    inArray(companiesTable.id, companyIds),
  );
}
