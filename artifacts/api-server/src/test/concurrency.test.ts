/**
 * Test Suite 38 — Concurrent invitation requests (Issue 5)
 *
 * Verifies that when two parallel invite-owner or invite-tenant requests race
 * for the same unit, exactly one succeeds (201) and the other returns 409.
 * No duplicate rows must exist in unit_memberships after the race.
 *
 * This relies on:
 *   1. The database partial unique index (um_one_owner_per_unit / um_one_tenant_per_unit)
 *      as the final enforcement layer.
 *   2. PostgreSQL error code 23505 translated to HTTP 409 in the route handler
 *      (Issue 5 FIX in invitations.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, unitMembershipsTable } from "@workspace/db";
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

describe("Suite 38 — Concurrent invitation race conditions", () => {
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

  it("concurrent invite-owner: exactly one 201 and one 409, no duplicate rows", async () => {
    const unit = await createTestUnit(company.id, building.id);

    // Fire two parallel invite-owner requests for the same unit
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/units/${unit.id}/invite-owner`)
        .set(authHeaders(adminUser.clerkUserId))
        .send({ invitedName: "Owner Race A", invitedEmail: "race-a@example.com" }),
      request(app)
        .post(`/api/units/${unit.id}/invite-owner`)
        .set(authHeaders(adminUser.clerkUserId))
        .send({ invitedName: "Owner Race B", invitedEmail: "race-b@example.com" }),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one must succeed and one must conflict
    expect(statuses).toEqual([201, 409]);

    // Exactly one row in unit_memberships for this unit with role=owner and status=pending
    const rows = await db
      .select()
      .from(unitMembershipsTable)
      .where(
        and(
          eq(unitMembershipsTable.unitId, unit.id),
          eq(unitMembershipsTable.role, "owner"),
          eq(unitMembershipsTable.status, "pending"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("concurrent invite-tenant: exactly one 201 and one 409, no duplicate rows", async () => {
    const unit = await createTestUnit(company.id, building.id);

    // Fire two parallel invite-tenant requests for the same unit
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/units/${unit.id}/invite-tenant`)
        .set(authHeaders(adminUser.clerkUserId))
        .send({ invitedName: "Tenant Race A", invitedEmail: "t-race-a@example.com" }),
      request(app)
        .post(`/api/units/${unit.id}/invite-tenant`)
        .set(authHeaders(adminUser.clerkUserId))
        .send({ invitedName: "Tenant Race B", invitedEmail: "t-race-b@example.com" }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Exactly one row for this unit/tenant/pending
    const rows = await db
      .select()
      .from(unitMembershipsTable)
      .where(
        and(
          eq(unitMembershipsTable.unitId, unit.id),
          eq(unitMembershipsTable.role, "tenant"),
          eq(unitMembershipsTable.status, "pending"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("409 response body contains a human-readable error message", async () => {
    const unit = await createTestUnit(company.id, building.id);

    // Create first invitation to make unit unavailable
    const first = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "First Owner", invitedEmail: "first-owner@example.com" });
    expect(first.status).toBe(201);

    // Second request must return 409 with a message
    const second = await request(app)
      .post(`/api/units/${unit.id}/invite-owner`)
      .set(authHeaders(adminUser.clerkUserId))
      .send({ invitedName: "Second Owner", invitedEmail: "second-owner@example.com" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBeTruthy();
    expect(typeof second.body.error).toBe("string");
    expect(second.body.error.length).toBeGreaterThan(0);
  });
});
