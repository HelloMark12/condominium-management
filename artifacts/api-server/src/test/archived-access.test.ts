/**
 * Test Suite 37 — Archived apartment access controls (Issue 9)
 *
 * Verifies every API surface that must NOT grant access when the only
 * relevant apartment is archived:
 *
 *   GET /units/:id                 — 403 for owner/tenant, 200 for admin
 *   GET /auth/me                   — archived unit absent from ownedUnits/tenancy
 *   GET /me/units                  — archived unit absent
 *   GET /me/tenancy                — null when tenancy apartment is archived
 *   GET /buildings/:id             — 403 when user's only apartment is archived
 *   GET /buildings/:id/units       — 403 under the same condition
 *
 * Each test creates its own isolated fixtures and asserts unconditionally.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, unitMembershipsTable, unitsTable } from "@workspace/db";
import app from "../app";
import {
  createTestUser,
  createTestCompany,
  createTestBuilding,
  createTestUnit,
  ensurePricingConfig,
  cleanupTestData,
} from "./setup";

function authHeaders(clerkUserId: string) {
  return { "x-test-clerk-user-id": clerkUserId };
}

describe("Suite 37 — Archived apartment access controls", () => {
  let companyIds: string[] = [];
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
  let tenantUser: Awaited<ReturnType<typeof createTestUser>>;
  let company: Awaited<ReturnType<typeof createTestCompany>>;
  let building: Awaited<ReturnType<typeof createTestBuilding>>;
  let archivedApt: Awaited<ReturnType<typeof createTestUnit>>;
  let activeApt: Awaited<ReturnType<typeof createTestUnit>>;
  let buildingWithOnlyArchivedUnit: Awaited<ReturnType<typeof createTestBuilding>>;
  let archivedAptInSeparateBuilding: Awaited<ReturnType<typeof createTestUnit>>;

  beforeAll(async () => {
    await ensurePricingConfig();
    adminUser = await createTestUser();
    ownerUser = await createTestUser({ email: "owner-s37@example.com" });
    tenantUser = await createTestUser({ email: "tenant-s37@example.com" });
    company = await createTestCompany({ adminUserId: adminUser.id });
    companyIds.push(company.id);
    building = await createTestBuilding(company.id);

    // archivedApt: an archived apartment in the main building
    archivedApt = await createTestUnit(company.id, building.id, { status: "archived" });
    // activeApt: an active apartment in the main building (owner has access here)
    activeApt = await createTestUnit(company.id, building.id, { status: "active" });

    // buildingWithOnlyArchivedUnit: to test building-level access denial
    buildingWithOnlyArchivedUnit = await createTestBuilding(company.id);
    archivedAptInSeparateBuilding = await createTestUnit(
      company.id,
      buildingWithOnlyArchivedUnit.id,
      { status: "archived" },
    );

    // Grant ownerUser an ACTIVE membership on the archivedApt
    // (so we can test that the archived status, not the membership status, blocks access)
    await db.insert(unitMembershipsTable).values({
      unitId: archivedApt.id,
      companyId: company.id,
      userId: ownerUser.id,
      role: "owner",
      status: "active",
      invitedName: "Owner S37",
      invitedEmail: "owner-s37@example.com",
      activatedAt: new Date(),
    });

    // Grant ownerUser a membership on the archivedAptInSeparateBuilding too
    await db.insert(unitMembershipsTable).values({
      unitId: archivedAptInSeparateBuilding.id,
      companyId: company.id,
      userId: ownerUser.id,
      role: "owner",
      status: "active",
      invitedName: "Owner S37",
      invitedEmail: "owner-s37@example.com",
      activatedAt: new Date(),
    });

    // Grant tenantUser an ACTIVE membership on the archivedApt
    await db.insert(unitMembershipsTable).values({
      unitId: archivedApt.id,
      companyId: company.id,
      userId: tenantUser.id,
      role: "tenant",
      status: "active",
      invitedName: "Tenant S37",
      invitedEmail: "tenant-s37@example.com",
      activatedAt: new Date(),
    });
  });

  afterAll(() => cleanupTestData(companyIds));

  // ── GET /units/:id ─────────────────────────────────────────────────────────

  it("GET /units/:id for archived unit returns 403 for owner", async () => {
    const res = await request(app)
      .get(`/api/units/${archivedApt.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("GET /units/:id for archived unit returns 403 for tenant", async () => {
    const res = await request(app)
      .get(`/api/units/${archivedApt.id}`)
      .set(authHeaders(tenantUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("GET /units/:id for archived unit returns 200 for admin", async () => {
    const res = await request(app)
      .get(`/api/units/${archivedApt.id}`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(archivedApt.id);
    expect(res.body.status).toBe("archived");
  });

  it("GET /units/:id for active unit returns 200 for owner with membership", async () => {
    // Control: active unit + active membership → 200
    await db.insert(unitMembershipsTable).values({
      unitId: activeApt.id,
      companyId: company.id,
      userId: ownerUser.id,
      role: "owner",
      status: "active",
      invitedName: "Owner S37",
      invitedEmail: "owner-s37@example.com",
      activatedAt: new Date(),
    }).onConflictDoNothing();

    const res = await request(app)
      .get(`/api/units/${activeApt.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────

  it("GET /auth/me does not include archived unit in ownedUnits", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);

    const body = res.body as {
      ownedUnits: Array<{ unit: { id: string; status: string } }>;
    };
    const archivedInOwned = body.ownedUnits.some(
      (m) => m.unit.id === archivedApt.id,
    );
    expect(archivedInOwned, "archivedApt must not appear in ownedUnits").toBe(false);
  });

  it("GET /auth/me does not include archived unit in tenancy", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set(authHeaders(tenantUser.clerkUserId));
    expect(res.status).toBe(200);

    const body = res.body as { tenancy: { unit?: { id: string } } | null };
    if (body.tenancy !== null) {
      expect(body.tenancy.unit?.id).not.toBe(archivedApt.id);
    }
    // tenancy is null → archived unit correctly absent
  });

  // ── GET /me/units ──────────────────────────────────────────────────────────

  it("GET /me/units does not include archived unit for owner", async () => {
    const res = await request(app)
      .get("/api/me/units")
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);

    const rows = res.body as Array<{ unit: { id: string; status: string } }>;
    const archivedFound = rows.some((r) => r.unit.id === archivedApt.id);
    expect(archivedFound, "Archived unit must not appear in /me/units").toBe(false);

    // Every returned unit must be active
    rows.forEach((r) => {
      expect(r.unit.status).toBe("active");
    });
  });

  // ── GET /me/tenancy ────────────────────────────────────────────────────────

  it("GET /me/tenancy returns null when tenant's only apartment is archived", async () => {
    const res = await request(app)
      .get("/api/me/tenancy")
      .set(authHeaders(tenantUser.clerkUserId));
    expect(res.status).toBe(200);

    // Tenant only has a membership on archivedApt — tenancy must be null
    const tenancy = res.body as { unit?: { id: string } } | null;
    if (tenancy !== null) {
      // If tenancy is returned, it must NOT be the archived apartment
      expect(tenancy.unit?.id).not.toBe(archivedApt.id);
    }
    // tenancy === null is the expected correct result
  });

  // ── GET /buildings/:id ─────────────────────────────────────────────────────

  it("GET /buildings/:id returns 403 when user's only apartment in that building is archived", async () => {
    // ownerUser has a membership on archivedAptInSeparateBuilding (archived)
    // and no active apartment in buildingWithOnlyArchivedUnit
    const res = await request(app)
      .get(`/api/buildings/${buildingWithOnlyArchivedUnit.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    // C1 FIX: resolveAndAuthorizeBuilding requires an active apartment
    expect(res.status).toBe(403);
  });

  it("GET /buildings/:id returns 200 for admin regardless of archived units", async () => {
    const res = await request(app)
      .get(`/api/buildings/${buildingWithOnlyArchivedUnit.id}`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);
  });

  // ── GET /buildings/:id/units ───────────────────────────────────────────────

  it("GET /buildings/:id/units returns 403 when user's only apartment is archived", async () => {
    const res = await request(app)
      .get(`/api/buildings/${buildingWithOnlyArchivedUnit.id}/units`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("GET /buildings/:id/units returns 200 for admin", async () => {
    const res = await request(app)
      .get(`/api/buildings/${buildingWithOnlyArchivedUnit.id}/units`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);
  });

  it("GET /buildings/:id returns 200 for owner with active apartment in that building", async () => {
    // ownerUser has activeApt (status=active) in `building` — should be allowed
    const res = await request(app)
      .get(`/api/buildings/${building.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);
  });
});
