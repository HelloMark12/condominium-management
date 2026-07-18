/**
 * Test Suite 27 — Invitation utilities
 * Test Suite 28 — Company isolation
 * Test Suite 30 — Owner invitation flows
 * Test Suite 31 — Tenant invitation flows
 * Tests C4 (archived unit invitations) and C5 (email verification)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { db, unitMembershipsTable, unitsTable, usersTable } from "@workspace/db";
import app from "../app";
import {
  createTestUser,
  createTestCompany,
  createTestBuilding,
  createTestUnit,
  ensurePricingConfig,
  cleanupTestData,
  uid,
} from "./setup";

// ── Test auth helper ──────────────────────────────────────────────────────────
// We inject a special header that our test-only auth middleware reads.

function authHeaders(clerkUserId: string) {
  return { "x-test-clerk-user-id": clerkUserId };
}

// ── Suite 27: Invitation utilities ───────────────────────────────────────────

describe("Suite 27 — Invitation utilities", () => {
  let companyIds: string[] = [];
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let company: Awaited<ReturnType<typeof createTestCompany>>;
  let building: Awaited<ReturnType<typeof createTestBuilding>>;
  let activeUnit: Awaited<ReturnType<typeof createTestUnit>>;
  let archivedUnit: Awaited<ReturnType<typeof createTestUnit>>;

  beforeAll(async () => {
    await ensurePricingConfig();
    adminUser = await createTestUser();
    company = await createTestCompany({ adminUserId: adminUser.id });
    companyIds.push(company.id);
    building = await createTestBuilding(company.id);
    activeUnit = await createTestUnit(company.id, building.id);
    archivedUnit = await createTestUnit(company.id, building.id, { status: "archived" });
  });

  afterAll(() => cleanupTestData(companyIds));

  it("C4: invite-owner rejects archived apartment with 422", async () => {
    const res = await request(app)
      .post(`/api/units/${archivedUnit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Jane", invitedEmail: "jane@example.com" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/archived/i);
  });

  it("C4: invite-tenant rejects archived apartment with 422", async () => {
    const res = await request(app)
      .post(`/api/units/${archivedUnit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Bob", invitedEmail: "bob@example.com" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/archived/i);
  });

  it("invite-owner succeeds for active apartment", async () => {
    const res = await request(app)
      .post(`/api/units/${activeUnit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Alice", invitedEmail: "alice@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("owner");
    expect(res.body.status).toBe("pending");
  });

  it("duplicate owner invite returns 409", async () => {
    // Already have a pending owner from previous test
    const res = await request(app)
      .post(`/api/units/${activeUnit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Alice2", invitedEmail: "alice2@example.com" });
    expect(res.status).toBe(409);
  });

  it("C5: accept with wrong email returns 403", async () => {
    // Create a separate unit with pending invitation
    const unit2 = await createTestUnit(company.id, building.id);
    const inviteRes = await request(app)
      .post(`/api/units/${unit2.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Charlie", invitedEmail: "charlie@example.com" });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.invitationToken;

    // Accept with a different user (wrong email)
    const wrongUser = await createTestUser({ email: "wrong@example.com" });
    const res = await request(app)
      .post("/api/invitations/accept")
      .set(authHeaders(wrongUser.clerkUserId))
      .send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/email/i);
  });

  it("C5: accept with correct email succeeds", async () => {
    const unit3 = await createTestUnit(company.id, building.id);
    const inviteRes = await request(app)
      .post(`/api/units/${unit3.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Dave", invitedEmail: "dave@example.com" });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.invitationToken;

    // Accept with correct email
    const correctUser = await createTestUser({ email: "dave@example.com" });
    const res = await request(app)
      .post("/api/invitations/accept")
      .set(authHeaders(correctUser.clerkUserId))
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body.membership.status).toBe("active");
    expect(res.body.redirectTo).toBe("/owner/home");
  });

  it("C4: accept invitation for archived apartment returns 422", async () => {
    // Create fresh unit with pending invite, then archive it
    const unit4 = await createTestUnit(company.id, building.id);
    const inviteRes = await request(app)
      .post(`/api/units/${unit4.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Eve", invitedEmail: "eve@example.com" });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.invitationToken;

    // Archive the unit
    await db
      .update(unitsTable)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(unitsTable.id, unit4.id));

    // Try to accept
    const correctUser = await createTestUser({ email: "eve@example.com" });
    const res = await request(app)
      .post("/api/invitations/accept")
      .set(authHeaders(correctUser.clerkUserId))
      .send({ token });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/archived/i);
  });
});

// ── Suite 28: Company isolation ───────────────────────────────────────────────

describe("Suite 28 — Company isolation", () => {
  let companyIds: string[] = [];
  let admin1: Awaited<ReturnType<typeof createTestUser>>;
  let admin2: Awaited<ReturnType<typeof createTestUser>>;
  let company1: Awaited<ReturnType<typeof createTestCompany>>;
  let company2: Awaited<ReturnType<typeof createTestCompany>>;
  let building1: Awaited<ReturnType<typeof createTestBuilding>>;
  let building2: Awaited<ReturnType<typeof createTestBuilding>>;
  let unit1: Awaited<ReturnType<typeof createTestUnit>>;

  beforeAll(async () => {
    await ensurePricingConfig();
    admin1 = await createTestUser();
    admin2 = await createTestUser();
    company1 = await createTestCompany({ adminUserId: admin1.id });
    company2 = await createTestCompany({ adminUserId: admin2.id });
    companyIds.push(company1.id, company2.id);
    building1 = await createTestBuilding(company1.id);
    building2 = await createTestBuilding(company2.id);
    unit1 = await createTestUnit(company1.id, building1.id);
  });

  afterAll(() => cleanupTestData(companyIds));

  it("admin2 cannot invite-owner to admin1's unit", async () => {
    const res = await request(app)
      .post(`/api/units/${unit1.id}/invite-owner`)
      .set(authHeaders(admin2.clerkUserId))
      .send({ invitedName: "Hacker", invitedEmail: "hack@example.com" });
    expect(res.status).toBe(403);
  });

  it("admin2 cannot GET admin1's building/units", async () => {
    const res = await request(app)
      .get(`/api/buildings/${building1.id}/units`)
      .set(authHeaders(admin2.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("admin1 cannot access company2 invitations list", async () => {
    const res = await request(app)
      .get(`/api/companies/${company2.id}/invitations`)
      .set(authHeaders(admin1.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("admin1 can access their own company invitations", async () => {
    const res = await request(app)
      .get(`/api/companies/${company1.id}/invitations`)
      .set(authHeaders(admin1.clerkUserId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Suite 29: Owner/tenant access controls ────────────────────────────────────

describe("Suite 29 — Owner/tenant access (C1, C3)", () => {
  let companyIds: string[] = [];
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>;
  let company: Awaited<ReturnType<typeof createTestCompany>>;
  let building: Awaited<ReturnType<typeof createTestBuilding>>;
  let activeUnit: Awaited<ReturnType<typeof createTestUnit>>;
  let archivedUnit: Awaited<ReturnType<typeof createTestUnit>>;

  beforeAll(async () => {
    await ensurePricingConfig();
    adminUser = await createTestUser();
    ownerUser = await createTestUser({ email: "owner-c29@example.com" });
    outsiderUser = await createTestUser();
    company = await createTestCompany({ adminUserId: adminUser.id });
    companyIds.push(company.id);
    building = await createTestBuilding(company.id);
    activeUnit = await createTestUnit(company.id, building.id);
    archivedUnit = await createTestUnit(company.id, building.id, { status: "archived" });

    // Assign owner to active unit
    await db.insert(unitMembershipsTable).values({
      unitId: activeUnit.id,
      companyId: company.id,
      userId: ownerUser.id,
      role: "owner",
      status: "active",
      invitedName: "Owner User",
      invitedEmail: "owner-c29@example.com",
      activatedAt: new Date(),
    });
  });

  afterAll(() => cleanupTestData(companyIds));

  it("C1: unauthenticated GET /buildings/:id returns 401", async () => {
    const res = await request(app).get(`/api/buildings/${building.id}`);
    expect(res.status).toBe(401);
  });

  it("C1: outsider cannot GET building detail", async () => {
    const res = await request(app)
      .get(`/api/buildings/${building.id}`)
      .set(authHeaders(outsiderUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("C1: owner with active apartment can GET building detail", async () => {
    const res = await request(app)
      .get(`/api/buildings/${building.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(building.id);
  });

  it("C1: outsider cannot GET building units", async () => {
    const res = await request(app)
      .get(`/api/buildings/${building.id}/units`)
      .set(authHeaders(outsiderUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("C1: outsider cannot PATCH building", async () => {
    const res = await request(app)
      .patch(`/api/buildings/${building.id}`)
      .set(authHeaders(outsiderUser.clerkUserId))
      .send({ name: "Hacked Building" });
    expect(res.status).toBe(403);
  });

  it("C3: GET /units/:id for archived unit returns 403 for non-admin", async () => {
    const res = await request(app)
      .get(`/api/units/${archivedUnit.id}`)
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(403);
  });

  it("C3: GET /units/:id for archived unit returns 200 for admin", async () => {
    const res = await request(app)
      .get(`/api/units/${archivedUnit.id}`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(res.status).toBe(200);
  });

  it("C3: GET /auth/me does not include archived unit in ownedUnits", async () => {
    // Assign ownerUser to archivedUnit to test the filter
    await db.insert(unitMembershipsTable).values({
      unitId: archivedUnit.id,
      companyId: company.id,
      userId: ownerUser.id,
      role: "owner",
      status: "active",
      invitedName: "Owner",
      invitedEmail: "owner-c29@example.com",
    }).onConflictDoNothing();

    const res = await request(app)
      .get("/api/auth/me")
      .set(authHeaders(ownerUser.clerkUserId));
    expect(res.status).toBe(200);
    const ownedUnits = res.body.ownedUnits as Array<{ unit: { id: string } }>;
    const hasArchived = ownedUnits.some((m) => m.unit.id === archivedUnit.id);
    expect(hasArchived).toBe(false);
  });
});

// ── Suite 30: Owner invitation flows ─────────────────────────────────────────

describe("Suite 30 — Owner invitation flows", () => {
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

  it("invite-owner requires name and email", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const res = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({});
    expect(res.status).toBe(400);
  });

  it("invite-owner creates pending membership with token", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const res = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Owner A", invitedEmail: "ownera@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.role).toBe("owner");
    expect(res.body.invitationToken).toBeTruthy();
    expect(res.body.invitedEmail).toBe("ownera@example.com");
  });

  it("H1: second owner invite for same unit returns 409", async () => {
    const unit = await createTestUnit(company.id, building.id);
    await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "First", invitedEmail: "first@example.com" });

    const res = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Second", invitedEmail: "second@example.com" });
    expect(res.status).toBe(409);
  });

  it("revoke then re-invite succeeds", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const invite1 = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Revokeable", invitedEmail: "revoke@example.com" });
    expect(invite1.status).toBe(201);

    // Revoke
    const revoke = await request(app)
      .delete(`/api/unit-memberships/${invite1.body.id}`)
      .set(authHeaders(adminUser.clerkUserId));
    expect(revoke.status).toBe(200);

    // Re-invite
    const invite2 = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "New Owner", invitedEmail: "new@example.com" });
    expect(invite2.status).toBe(201);
  });
});

// ── Suite 31: Tenant invitation flows ─────────────────────────────────────────

describe("Suite 31 — Tenant invitation flows", () => {
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

  it("invite-tenant creates pending tenant membership", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const res = await request(app)
      .post(`/api/units/${unit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Tenant A", invitedEmail: "tenanta@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("tenant");
    expect(res.body.status).toBe("pending");
  });

  it("H2: second tenant invite for same unit returns 409", async () => {
    const unit = await createTestUnit(company.id, building.id);
    await request(app)
      .post(`/api/units/${unit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "T1", invitedEmail: "t1@example.com" });

    const res = await request(app)
      .post(`/api/units/${unit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "T2", invitedEmail: "t2@example.com" });
    expect(res.status).toBe(409);
  });

  it("tenant accept redirects to /tenant/home", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const invite = await request(app)
      .post(`/api/units/${unit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Accepting Tenant", invitedEmail: "accepting.tenant@example.com" });
    const token = invite.body.invitationToken;

    const tenantUser = await createTestUser({ email: "accepting.tenant@example.com" });
    const res = await request(app)
      .post("/api/invitations/accept")
      .set(authHeaders(tenantUser.clerkUserId))
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/tenant/home");
    expect(res.body.role).toBe("tenant");
  });

  it("H3: revocation is scoped to the exact target membership", async () => {
    const unit = await createTestUnit(company.id, building.id);
    const invite = await request(app)
      .post(`/api/units/${unit.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Targeted Tenant", invitedEmail: "targeted@example.com" });
    const membershipId = invite.body.id;

    // Create another unit with its own membership
    const unit2 = await createTestUnit(company.id, building.id);
    const invite2 = await request(app)
      .post(`/api/units/${unit2.id}/invite-tenant`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Safe Tenant", invitedEmail: "safe@example.com" });
    const safeMembershipId = invite2.body.id;

    // Revoke only the first
    await request(app)
      .delete(`/api/unit-memberships/${membershipId}`)
      .set(authHeaders(adminUser.clerkUserId));

    // Check the second is still pending
    const [safeMembership] = await db
      .select()
      .from(unitMembershipsTable)
      .where(eq(unitMembershipsTable.id, safeMembershipId))
      .limit(1);
    expect(safeMembership?.status).toBe("pending");
  });
});
