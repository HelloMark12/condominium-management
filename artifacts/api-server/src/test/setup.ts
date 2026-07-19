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
  noticesTable,
  noticeBuildingTargetsTable,
  noticeUnitTargetsTable,
  noticeVersionsTable,
  noticeDeliveriesTable,
  noticeDeliveryContextsTable,
  buildingTimelineEventsTable,
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
  status: "active" | "inactive";
}> = {}) {
  const [building] = await db
    .insert(buildingsTable)
    .values({
      companyId,
      name: overrides.name ?? `Building ${uid()}`,
      locality: "Valletta",
      status: overrides.status ?? "active",
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

// ── Unit membership fixtures ─────────────────────────────────────────────────

export async function createTestMembership(
  unitId: string,
  companyId: string,
  userId: string,
  role: "owner" | "tenant",
) {
  const [membership] = await db
    .insert(unitMembershipsTable)
    .values({
      unitId,
      companyId,
      userId,
      role,
      status: "active",
      invitedName: "Test User",
      invitedEmail: `${uid()}@test.example`,
      activatedAt: new Date(),
    })
    .returning();
  return membership!;
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

// ── Notice fixtures ──────────────────────────────────────────────────────────

export async function createTestNotice(
  companyId: string,
  createdByUserId: string,
  overrides: Partial<{
    title: string;
    body: string;
    category: "general" | "emergency" | "planned_maintenance" | "cleaning" | "lift" | "agm_announcement" | "other";
    audience: "owners_only" | "tenants_only" | "owners_and_tenants";
    targetingMode: "company_wide" | "buildings" | "apartments";
    status: "draft" | "scheduled" | "published" | "archived";
    scheduledPublishAt: Date;
  }> = {},
) {
  const [notice] = await db
    .insert(noticesTable)
    .values({
      companyId,
      title: overrides.title ?? `Notice ${uid()}`,
      body: overrides.body ?? "Test notice body",
      category: overrides.category ?? "general",
      audience: overrides.audience ?? "owners_and_tenants",
      targetingMode: overrides.targetingMode ?? "company_wide",
      status: overrides.status ?? "draft",
      versionNumber: 1,
      createdByUserId,
      scheduledPublishAt: overrides.scheduledPublishAt ?? null,
    })
    .returning();
  return notice!;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupNoticeData(noticeIds: string[]) {
  if (noticeIds.length === 0) return;
  // FK-safe order:
  //  1. delivery contexts (FK → deliveries)
  //  2. deliveries (FK → notices)
  //  3. versions (FK → notices)
  //  4. building targets (FK → notices)
  //  5. unit targets (FK → notices)
  //  6. building_timeline_events (FK → notices)
  //  7. notices (root table)
  const deliveryIds = await db
    .select({ id: noticeDeliveriesTable.id })
    .from(noticeDeliveriesTable)
    .where(inArray(noticeDeliveriesTable.noticeId, noticeIds));
  if (deliveryIds.length > 0) {
    await db.delete(noticeDeliveryContextsTable).where(
      inArray(noticeDeliveryContextsTable.deliveryId, deliveryIds.map((d) => d.id)),
    );
  }
  await db.delete(noticeDeliveriesTable).where(
    inArray(noticeDeliveriesTable.noticeId, noticeIds),
  );
  await db.delete(noticeVersionsTable).where(
    inArray(noticeVersionsTable.noticeId, noticeIds),
  );
  await db.delete(noticeBuildingTargetsTable).where(
    inArray(noticeBuildingTargetsTable.noticeId, noticeIds),
  );
  await db.delete(noticeUnitTargetsTable).where(
    inArray(noticeUnitTargetsTable.noticeId, noticeIds),
  );
  // building_timeline_events has a FK → notices.id (must delete before notices)
  await db.delete(buildingTimelineEventsTable).where(
    inArray(buildingTimelineEventsTable.noticeId, noticeIds),
  );
  await db.delete(noticesTable).where(
    inArray(noticesTable.id, noticeIds),
  );
}

export async function cleanupTestData(companyIds: string[]) {
  if (companyIds.length === 0) return;

  // First clean up all notices for these companies
  const noticeRows = await db
    .select({ id: noticesTable.id })
    .from(noticesTable)
    .where(inArray(noticesTable.companyId, companyIds));
  await cleanupNoticeData(noticeRows.map((n) => n.id));

  // Clean up building timeline events
  const buildingRows = await db
    .select({ id: buildingsTable.id })
    .from(buildingsTable)
    .where(inArray(buildingsTable.companyId, companyIds));
  if (buildingRows.length > 0) {
    await db.delete(buildingTimelineEventsTable).where(
      inArray(buildingTimelineEventsTable.buildingId, buildingRows.map((b) => b.id)),
    );
  }

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
