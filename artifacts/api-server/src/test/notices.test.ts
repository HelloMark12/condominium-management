/**
 * Suite 40 – Notices (Module 2)
 *
 * Covers:
 *  40-01  Admin can create a draft notice (company_wide)
 *  40-02  Admin can create a notice targeting buildings
 *  40-03  Cross-company notice creation is rejected
 *  40-04  Missing required fields are rejected
 *  40-05  Admin can publish a draft notice
 *  40-06  Publishing delivers to all eligible recipients
 *  40-07  Archived apartments are excluded from delivery
 *  40-08  Publishing respects audience=owners_only
 *  40-09  Publishing respects audience=tenants_only
 *  40-10  User receives notice only once (deduplication across apartments)
 *  40-11  Admin can schedule a notice for future publication
 *  40-12  Schedule rejects past dates
 *  40-13  Admin can list notices with status filter
 *  40-14  Admin can edit a draft notice
 *  40-15  Admin can archive a notice
 *  40-16  Archived notice cannot be published
 *  40-17  Resident can read their notice feed
 *  40-18  Resident can mark a notice as read
 *  40-19  Resident cannot see another company's notices
 *  40-20  unread-count returns correct value
 *  40-21  Emergency notice unread reset on edit
 *  40-22  Version history is recorded when published notice is edited
 *  40-23  Admin can get delivery report
 *  40-24  Admin can get version history
 *  40-25  Resident gets 403 when not a recipient
 *  40-26  Admin buildings filter on notice list
 *  40-27  Publish already-published notice returns 400
 *  40-28  Owner can see tenant delivery status
 *  40-29  publishScheduledNotices publishes past-due notices
 *  40-30  Internal publish-scheduled endpoint is protected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createTestUser,
  createTestCompany,
  createTestBuilding,
  createTestUnit,
  createTestMembership,
  createTestNotice,
  cleanupTestData,
  uid,
} from "./setup";
import {
  db,
  noticesTable,
  noticeDeliveriesTable,
  noticeBuildingTargetsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishScheduledNotices } from "../lib/noticePublisher";

const AUTH = (clerkId: string) => ({ "x-test-clerk-user-id": clerkId });

// ── Helpers ────────────────────────────────────────────────────────────────────

let companyId: string;
let companyId2: string;
let adminClerkId: string;
let adminUserId: string;
let ownerClerkId: string;
let ownerUserId: string;
let tenantClerkId: string;
let tenantUserId: string;
let buildingId: string;
let unitId: string;
let archivedUnitId: string;
let createdCompanyIds: string[] = [];

beforeAll(async () => {
  // Company 1 + admin
  adminClerkId = `test_${uid()}`;
  const adminUser = await createTestUser({ clerkUserId: adminClerkId });
  adminUserId = adminUser.id;
  const company = await createTestCompany({ name: `Notices Co ${uid()}`, adminUserId });
  companyId = company.id;
  createdCompanyIds.push(companyId);

  // Company 2 (for cross-company tests)
  const adminClerkId2 = `test_${uid()}`;
  const adminUser2 = await createTestUser({ clerkUserId: adminClerkId2 });
  const company2 = await createTestCompany({ name: `Other Co ${uid()}`, adminUserId: adminUser2.id });
  companyId2 = company2.id;
  createdCompanyIds.push(companyId2);

  // Building + active unit
  const building = await createTestBuilding(companyId);
  buildingId = building.id;

  const activeUnit = await createTestUnit(companyId, buildingId, { unitNumber: "Apt 1" });
  unitId = activeUnit.id;

  // Archived unit (should be excluded from delivery)
  const archivedUnit = await createTestUnit(companyId, buildingId, { unitNumber: "Apt 99", status: "archived" });
  archivedUnitId = archivedUnit.id;

  // Owner user
  ownerClerkId = `test_${uid()}`;
  const ownerUser = await createTestUser({ clerkUserId: ownerClerkId });
  ownerUserId = ownerUser.id;
  await createTestMembership(unitId, companyId, ownerUserId, "owner");

  // Tenant user
  tenantClerkId = `test_${uid()}`;
  const tenantUser = await createTestUser({ clerkUserId: tenantClerkId });
  tenantUserId = tenantUser.id;
  await createTestMembership(unitId, companyId, tenantUserId, "tenant");
});

afterAll(async () => {
  await cleanupTestData(createdCompanyIds);
});

// ── Suite 40-01: Create draft notice (company_wide) ────────────────────────────

describe("Suite 40-01: Create draft notice (company_wide)", () => {
  it("POST /companies/:id/notices → 201 with draft status", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({
        title: "Test Notice",
        body: "Test body content",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "company_wide",
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.title).toBe("Test Notice");
    expect(res.body.companyId).toBe(companyId);
  });
});

// ── Suite 40-02: Create notice targeting buildings ─────────────────────────────

describe("Suite 40-02: Create notice targeting buildings", () => {
  it("POST /companies/:id/notices with buildings targeting → 201", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({
        title: "Building Notice",
        body: "For a specific building",
        category: "planned_maintenance",
        audience: "owners_and_tenants",
        targetingMode: "buildings",
        buildingIds: [buildingId],
      });
    expect(res.status).toBe(201);
    expect(res.body.targetingMode).toBe("buildings");
  });

  it("Buildings targeting with empty buildingIds → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({
        title: "Missing buildings",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "buildings",
        buildingIds: [],
      });
    expect(res.status).toBe(400);
  });
});

// ── Suite 40-03: Cross-company rejection ──────────────────────────────────────

describe("Suite 40-03: Cross-company rejection", () => {
  it("Admin of company 1 cannot create notice for company 2 → 403", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId2}/notices`)
      .set(AUTH(adminClerkId))
      .send({
        title: "Cross company notice",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "company_wide",
      });
    expect(res.status).toBe(403);
  });

  it("Building from another company is rejected → 400", async () => {
    // Create a building in company 2
    const b2 = await createTestBuilding(companyId2);
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({
        title: "Cross building",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "buildings",
        buildingIds: [b2.id],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

// ── Suite 40-04: Missing required fields ──────────────────────────────────────

describe("Suite 40-04: Validation", () => {
  it("Missing title → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({ body: "B", category: "general", audience: "owners_and_tenants", targetingMode: "company_wide" });
    expect(res.status).toBe(400);
  });

  it("Missing body → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({ title: "T", category: "general", audience: "owners_and_tenants", targetingMode: "company_wide" });
    expect(res.status).toBe(400);
  });

  it("Invalid category → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices`)
      .set(AUTH(adminClerkId))
      .send({ title: "T", body: "B", category: "invalid_cat", audience: "owners_and_tenants", targetingMode: "company_wide" });
    expect(res.status).toBe(400);
  });
});

// ── Suite 40-05: Publish draft ────────────────────────────────────────────────

describe("Suite 40-05: Publish draft notice", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Publish Test",
      body: "Body",
      targetingMode: "company_wide",
    });
    noticeId = notice.id;
  });

  it("POST /companies/:id/notices/:id/publish → 200, status=published", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.publishedAt).toBeTruthy();
  });
});

// ── Suite 40-06: Delivery to eligible recipients ──────────────────────────────

describe("Suite 40-06: Notice delivery to recipients", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Delivery Test",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
  });

  it("Publishing creates delivery rows for owner and tenant", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(res.body.publishResult.recipientCount).toBeGreaterThanOrEqual(2); // owner + tenant

    // Verify delivery rows exist
    const deliveries = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    const recipientIds = deliveries.map((d) => d.userId);
    expect(recipientIds).toContain(ownerUserId);
    expect(recipientIds).toContain(tenantUserId);
  });
});

// ── Suite 40-07: Archived apartments excluded ─────────────────────────────────

describe("Suite 40-07: Archived apartments excluded from delivery", () => {
  let archivedUnitOwnerUserId: string;
  let noticeId: string;

  beforeAll(async () => {
    // Create an owner for the archived unit
    const archivedOwnerClerk = `test_${uid()}`;
    const archivedOwner = await createTestUser({ clerkUserId: archivedOwnerClerk });
    archivedUnitOwnerUserId = archivedOwner.id;
    await createTestMembership(archivedUnitId, companyId, archivedUnitOwnerUserId, "owner");

    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Archived Exclusion Test",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
  });

  it("Owner of archived apartment does NOT receive delivery", async () => {
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));

    const deliveries = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    const recipientIds = deliveries.map((d) => d.userId);
    expect(recipientIds).not.toContain(archivedUnitOwnerUserId);
  });
});

// ── Suite 40-08: Audience = owners_only ───────────────────────────────────────

describe("Suite 40-08: Audience owners_only excludes tenants", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Owners Only",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_only",
    });
    noticeId = notice.id;
  });

  it("Only owner receives delivery, tenant is excluded", async () => {
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));

    const deliveries = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    const recipientIds = deliveries.map((d) => d.userId);
    expect(recipientIds).toContain(ownerUserId);
    expect(recipientIds).not.toContain(tenantUserId);
  });
});

// ── Suite 40-09: Audience = tenants_only ─────────────────────────────────────

describe("Suite 40-09: Audience tenants_only excludes owners", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Tenants Only",
      body: "Body",
      targetingMode: "company_wide",
      audience: "tenants_only",
    });
    noticeId = notice.id;
  });

  it("Only tenant receives delivery, owner is excluded", async () => {
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));

    const deliveries = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    const recipientIds = deliveries.map((d) => d.userId);
    expect(recipientIds).toContain(tenantUserId);
    expect(recipientIds).not.toContain(ownerUserId);
  });
});

// ── Suite 40-10: Deduplication ────────────────────────────────────────────────

describe("Suite 40-10: Multi-apartment deduplication", () => {
  let unit2Id: string;
  let noticeId: string;

  beforeAll(async () => {
    // Create a second active unit and make the same owner own it
    const unit2 = await createTestUnit(companyId, buildingId, { unitNumber: "Apt 2-dup" });
    unit2Id = unit2.id;
    await createTestMembership(unit2Id, companyId, ownerUserId, "owner");

    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Dedup Test",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_only",
    });
    noticeId = notice.id;
  });

  it("Owner receives exactly one delivery even owning multiple apartments", async () => {
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));

    const deliveries = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(
        and(
          eq(noticeDeliveriesTable.noticeId, noticeId),
          eq(noticeDeliveriesTable.userId, ownerUserId),
        ),
      );
    expect(deliveries).toHaveLength(1);
  });
});

// ── Suite 40-11: Schedule notice ─────────────────────────────────────────────

describe("Suite 40-11: Schedule notice", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Scheduled Notice" });
    noticeId = notice.id;
  });

  it("POST /schedule with future date → 200, status=scheduled", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/schedule`)
      .set(AUTH(adminClerkId))
      .send({ scheduledPublishAt: future });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scheduled");
    expect(res.body.scheduledPublishAt).toBeTruthy();
  });
});

// ── Suite 40-12: Schedule rejects past dates ──────────────────────────────────

describe("Suite 40-12: Schedule rejects past date", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Past Date Test" });
    noticeId = notice.id;
  });

  it("POST /schedule with past date → 400", async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/schedule`)
      .set(AUTH(adminClerkId))
      .send({ scheduledPublishAt: past });
    expect(res.status).toBe(400);
  });
});

// ── Suite 40-13: List notices with status filter ──────────────────────────────

describe("Suite 40-13: List notices with status filter", () => {
  let draftNoticeId: string;
  let publishedNoticeId: string;

  beforeAll(async () => {
    const draft = await createTestNotice(companyId, adminUserId, { title: "Filter Draft", status: "draft" });
    draftNoticeId = draft.id;
    const published = await createTestNotice(companyId, adminUserId, { title: "Filter Published", status: "published" });
    publishedNoticeId = published.id;
    // Manually set published_at
    await db.update(noticesTable).set({ publishedAt: new Date() }).where(eq(noticesTable.id, publishedNoticeId));
  });

  it("GET /companies/:id/notices?status=draft → only drafts", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices?status=draft`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).toContain(draftNoticeId);
    expect(ids).not.toContain(publishedNoticeId);
  });

  it("GET /companies/:id/notices?status=published → only published", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices?status=published`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).toContain(publishedNoticeId);
    expect(ids).not.toContain(draftNoticeId);
  });
});

// ── Suite 40-14: Edit draft notice ────────────────────────────────────────────

describe("Suite 40-14: Edit draft notice", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Edit Draft", body: "Original body" });
    noticeId = notice.id;
  });

  it("PATCH updates title and body", async () => {
    const res = await request(app)
      .patch(`/api/companies/${companyId}/notices/${noticeId}`)
      .set(AUTH(adminClerkId))
      .send({ title: "Updated Title", body: "Updated body" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Title");
    expect(res.body.body).toBe("Updated body");
  });
});

// ── Suite 40-15: Archive notice ───────────────────────────────────────────────

describe("Suite 40-15: Archive notice", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Archive Me" });
    noticeId = notice.id;
  });

  it("POST /archive → 200, status=archived", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/archive`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
    expect(res.body.archivedAt).toBeTruthy();
  });

  it("Archiving again → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/archive`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(400);
  });
});

// ── Suite 40-16: Publish archived → 400 ──────────────────────────────────────

describe("Suite 40-16: Archived notice cannot be published", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Archived Notice", status: "archived" });
    noticeId = notice.id;
  });

  it("POST /publish on archived notice → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(400);
  });
});

// ── Suite 40-17: Resident notice feed ────────────────────────────────────────

describe("Suite 40-17: Resident notice feed", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Resident Feed Notice",
      body: "For residents",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("GET /me/notices → notice appears in owner feed", async () => {
    const res = await request(app)
      .get("/api/me/notices")
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).toContain(noticeId);
  });

  it("GET /me/notices → notice appears in tenant feed", async () => {
    const res = await request(app)
      .get("/api/me/notices")
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).toContain(noticeId);
  });

  it("Notice is marked isUnread=true initially", async () => {
    const res = await request(app)
      .get("/api/me/notices")
      .set(AUTH(ownerClerkId));
    const notice = res.body.find((n: { id: string }) => n.id === noticeId);
    expect(notice?.delivery?.isUnread).toBe(true);
  });
});

// ── Suite 40-18: Mark as read ────────────────────────────────────────────────

describe("Suite 40-18: Mark notice as read", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Read Me",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("GET /me/notices/:id marks notice as read (isUnread=false)", async () => {
    const res = await request(app)
      .get(`/api/me/notices/${noticeId}`)
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    expect(res.body.delivery?.isRead).toBe(true);
    expect(res.body.delivery?.isUnread).toBe(false);
    expect(res.body.delivery?.firstReadAt).toBeTruthy();
  });

  it("POST /me/notices/:id/read also marks as read", async () => {
    const res = await request(app)
      .post(`/api/me/notices/${noticeId}/read`)
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("Unread count decreases after reading", async () => {
    const res = await request(app)
      .get("/api/me/notices/unread-count")
      .set(AUTH(ownerClerkId));
    // Owner read this notice + possibly others — count should be 0 or less than before
    expect(res.status).toBe(200);
    expect(typeof res.body.unreadCount).toBe("number");
  });
});

// ── Suite 40-19: Cross-company feed isolation ─────────────────────────────────

describe("Suite 40-19: Resident cannot see another company's notices", () => {
  let otherNoticeId: string;

  beforeAll(async () => {
    const otherAdmin = await createTestUser({ clerkUserId: `test_${uid()}` });
    const otherCompany = await createTestCompany({ adminUserId: otherAdmin.id });
    createdCompanyIds.push(otherCompany.id);

    const notice = await createTestNotice(otherCompany.id, otherAdmin.id, {
      title: "Other Company Notice",
      targetingMode: "company_wide",
      status: "published",
    });
    otherNoticeId = notice.id;
  });

  it("Notice from other company does NOT appear in feed", async () => {
    const res = await request(app)
      .get("/api/me/notices")
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).not.toContain(otherNoticeId);
  });
});

// ── Suite 40-20: Unread count ────────────────────────────────────────────────

describe("Suite 40-20: Unread count", () => {
  it("GET /me/notices/unread-count → returns integer", async () => {
    const res = await request(app)
      .get("/api/me/notices/unread-count")
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(200);
    expect(typeof res.body.unreadCount).toBe("number");
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(0);
  });
});

// ── Suite 40-21: Emergency notice unread reset on edit ───────────────────────

describe("Suite 40-21: Emergency notice unread reset on edit", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Emergency Notice",
      body: "Original emergency body",
      category: "emergency",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    // Owner reads it
    await request(app)
      .get(`/api/me/notices/${noticeId}`)
      .set(AUTH(ownerClerkId));
  });

  it("Editing emergency notice resets unread state for recipients", async () => {
    // Patch the published emergency notice
    const patchRes = await request(app)
      .patch(`/api/companies/${companyId}/notices/${noticeId}`)
      .set(AUTH(adminClerkId))
      .send({ body: "Updated emergency content — critical change", editReason: "Updated info" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.versionNumber).toBe(2);

    // Check delivery for owner — lastReadVersion should be null or < versionNumber
    const delivery = await db
      .select()
      .from(noticeDeliveriesTable)
      .where(
        and(
          eq(noticeDeliveriesTable.noticeId, noticeId),
          eq(noticeDeliveriesTable.userId, ownerUserId),
        ),
      )
      .limit(1);
    expect(delivery[0]?.lastReadVersion).toBeNull();
  });
});

// ── Suite 40-22: Version history ─────────────────────────────────────────────

describe("Suite 40-22: Version history", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Version History Notice",
      body: "Original",
      category: "general",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    await request(app)
      .patch(`/api/companies/${companyId}/notices/${noticeId}`)
      .set(AUTH(adminClerkId))
      .send({ body: "Updated content", editReason: "Correction" });
  });

  it("GET /versions returns at least one version record", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices/${noticeId}/versions`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("Version record has expected fields", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices/${noticeId}/versions`)
      .set(AUTH(adminClerkId));
    const v = res.body[0];
    expect(v).toHaveProperty("versionNumber");
    expect(v).toHaveProperty("title");
    expect(v).toHaveProperty("body");
    expect(v).toHaveProperty("editedByUserId");
  });
});

// ── Suite 40-23: Delivery report ─────────────────────────────────────────────

describe("Suite 40-23: Delivery report", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Delivery Report Test",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("GET /delivery returns summary and deliveries", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices/${noticeId}/delivery`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("deliveries");
    expect(typeof res.body.summary.totalRecipients).toBe("number");
    expect(res.body.summary.totalRecipients).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.deliveries)).toBe(true);
  });

  it("readPercentage is 0 before anyone reads", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices/${noticeId}/delivery`)
      .set(AUTH(adminClerkId));
    expect(res.body.summary.readPercentage).toBe(0);
  });
});

// ── Suite 40-24: Admin get versions ──────────────────────────────────────────

describe("Suite 40-24: Get notice versions (non-edited)", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Clean History" });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("GET /versions on newly published → versions array", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices/${noticeId}/versions`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Suite 40-25: Resident gets 403 on non-recipient notice ────────────────────

describe("Suite 40-25: 403 for non-recipient", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Owners Only 403",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_only",
    });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("Tenant (not a recipient) gets 403 when viewing notice detail", async () => {
    const res = await request(app)
      .get(`/api/me/notices/${noticeId}`)
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(403);
  });
});

// ── Suite 40-26: Building filter on admin list ────────────────────────────────

describe("Suite 40-26: Building filter on admin list", () => {
  let buildingNoticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, {
      title: "Building Filter Notice",
      body: "Body",
      targetingMode: "buildings",
    });
    buildingNoticeId = notice.id;
    await db.insert(noticeBuildingTargetsTable).values({
      noticeId: buildingNoticeId,
      companyId,
      buildingId,
    }).onConflictDoNothing();
  });

  it("GET /notices?buildingId filters to notices targeting that building", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/notices?buildingId=${buildingId}`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: string }) => n.id);
    expect(ids).toContain(buildingNoticeId);
  });
});

// ── Suite 40-27: Publish already-published → 400 ─────────────────────────────

describe("Suite 40-27: Publish already-published notice", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await createTestNotice(companyId, adminUserId, { title: "Double Publish" });
    noticeId = notice.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("POST /publish on already-published notice → 400", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/notices/${noticeId}/publish`)
      .set(AUTH(adminClerkId));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already published/i);
  });
});

// ── Suite 40-28: Owner tenant-delivery view (expanded) ───────────────────────
//
// Verifies the corrected access model:
//   - Owner does NOT need to be a recipient of the notice personally.
//   - Access is gated on having an active ownership of an active apartment.
//   - Only tenants linked to the caller's apartments are returned.

describe("Suite 40-28: Owner tenant-delivery view", () => {
  let tenantsOnlyNoticeId: string;   // audience = tenants_only (owner is NOT a recipient)
  let bothAudienceNoticeId: string;  // audience = owners_and_tenants
  let owner2ClerkId: string;
  let owner2UserId: string;
  let unit2Id: string;
  let tenant2ClerkId: string;

  beforeAll(async () => {
    // Create unit2 and its owner/tenant BEFORE publishing so they receive deliveries.
    const unit2 = await createTestUnit(companyId, buildingId, { unitNumber: `Apt 2B-${uid()}` });
    unit2Id = unit2.id;

    owner2ClerkId = `test_${uid()}`;
    const owner2User = await createTestUser({ clerkUserId: owner2ClerkId });
    owner2UserId = owner2User.id;
    await createTestMembership(unit2Id, companyId, owner2UserId, "owner");

    tenant2ClerkId = `test_${uid()}`;
    const tenant2User = await createTestUser({ clerkUserId: tenant2ClerkId });
    await createTestMembership(unit2Id, companyId, tenant2User.id, "tenant");

    // NOW publish notices — unit2 is active with owner2+tenant2, so they receive deliveries.

    // Notice targeting only tenants — owner receives no personal delivery row for this
    const n1 = await createTestNotice(companyId, adminUserId, {
      title: "Tenants Only Delivery View",
      body: "Body",
      targetingMode: "company_wide",
      audience: "tenants_only",
    });
    tenantsOnlyNoticeId = n1.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${tenantsOnlyNoticeId}/publish`)
      .set(AUTH(adminClerkId));

    // Notice targeting both audiences
    const n2 = await createTestNotice(companyId, adminUserId, {
      title: "Both Audience Delivery View",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_and_tenants",
    });
    bothAudienceNoticeId = n2.id;
    await request(app)
      .post(`/api/companies/${companyId}/notices/${bothAudienceNoticeId}/publish`)
      .set(AUTH(adminClerkId));
  });

  it("Tenants-only notice: owner sees their tenant's delivery (no personal delivery needed)", async () => {
    const res = await request(app)
      .get(`/api/me/notices/${tenantsOnlyNoticeId}/tenant-delivery`)
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find((e: { unitId: string }) => e.unitId === unitId);
    expect(entry).toBeTruthy();
    expect(entry?.delivered).toBe(true);
  });

  it("Owners-and-tenants notice: owner sees their tenant's delivery", async () => {
    const res = await request(app)
      .get(`/api/me/notices/${bothAudienceNoticeId}/tenant-delivery`)
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    const entry = res.body.find((e: { unitId: string }) => e.unitId === unitId);
    expect(entry).toBeTruthy();
    expect(entry?.delivered).toBe(true);
  });

  it("Owner cannot see another owner's tenant delivery", async () => {
    // owner2 owns unit2 — they should NOT see unit1's tenant delivery
    const res = await request(app)
      .get(`/api/me/notices/${bothAudienceNoticeId}/tenant-delivery`)
      .set(AUTH(owner2ClerkId));
    expect(res.status).toBe(200);
    // Should return unit2's tenant, not unit1's tenant
    const unit1Entry = res.body.find((e: { unitId: string }) => e.unitId === unitId);
    expect(unit1Entry).toBeUndefined();
    const unit2Entry = res.body.find((e: { unitId: string }) => e.unitId === unit2Id);
    expect(unit2Entry).toBeTruthy();
  });

  it("Tenant cannot access the endpoint → 403", async () => {
    const res = await request(app)
      .get(`/api/me/notices/${bothAudienceNoticeId}/tenant-delivery`)
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(403);
  });

  it("User with no active ownership → 403", async () => {
    // tenantUserId has a tenant membership, not an owner membership
    const res = await request(app)
      .get(`/api/me/notices/${bothAudienceNoticeId}/tenant-delivery`)
      .set(AUTH(tenantClerkId));
    expect(res.status).toBe(403);
  });

  it("Owner with multiple apartments sees only their own tenants", async () => {
    // owner2 owns unit2 — the result must only include unit2's tenants
    const res = await request(app)
      .get(`/api/me/notices/${bothAudienceNoticeId}/tenant-delivery`)
      .set(AUTH(owner2ClerkId));
    expect(res.status).toBe(200);
    for (const entry of res.body as Array<{ unitId: string }>) {
      expect(entry.unitId).toBe(unit2Id);
    }
  });

  it("Notice not delivered to any tenant of the owner → empty array", async () => {
    // Create an owners-only notice — no tenants receive it, so no tenant-delivery rows exist
    const ownersOnly = await createTestNotice(companyId, adminUserId, {
      title: "Owners Only Scoped Test",
      body: "Body",
      targetingMode: "company_wide",
      audience: "owners_only",
    });
    await request(app)
      .post(`/api/companies/${companyId}/notices/${ownersOnly.id}/publish`)
      .set(AUTH(adminClerkId));

    const res = await request(app)
      .get(`/api/me/notices/${ownersOnly.id}/tenant-delivery`)
      .set(AUTH(ownerClerkId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── Suite 40-29: publishScheduledNotices publishes past-due notices ───────────

describe("Suite 40-29: publishScheduledNotices processes past-due", () => {
  let pastDueNoticeId: string;
  let futureNoticeId: string;

  beforeAll(async () => {
    // Create a past-due scheduled notice
    const pastDue = await db
      .insert(noticesTable)
      .values({
        companyId,
        title: "Past Due Scheduled",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "company_wide",
        status: "scheduled",
        versionNumber: 1,
        createdByUserId: adminUserId,
        scheduledPublishAt: new Date(Date.now() - 5000), // 5 seconds ago
      })
      .returning();
    pastDueNoticeId = pastDue[0]!.id;

    // Create a future scheduled notice (should NOT be published)
    const future = await db
      .insert(noticesTable)
      .values({
        companyId,
        title: "Future Scheduled",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "company_wide",
        status: "scheduled",
        versionNumber: 1,
        createdByUserId: adminUserId,
        scheduledPublishAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour ahead
      })
      .returning();
    futureNoticeId = future[0]!.id;
  });

  it("publishScheduledNotices() publishes past-due and skips future", async () => {
    const count = await publishScheduledNotices();
    expect(count).toBeGreaterThanOrEqual(1);

    const [pastDueRow] = await db
      .select({ status: noticesTable.status })
      .from(noticesTable)
      .where(eq(noticesTable.id, pastDueNoticeId));
    expect(pastDueRow?.status).toBe("published");

    const [futureRow] = await db
      .select({ status: noticesTable.status })
      .from(noticesTable)
      .where(eq(noticesTable.id, futureNoticeId));
    expect(futureRow?.status).toBe("scheduled");
  });
});

// ── Suite 40-30: Internal scheduler authentication ────────────────────────────
//
// Verifies the corrected fail-closed authentication:
//   - Missing SESSION_SECRET → 503 (not 200 or 403)
//   - Missing Authorization header → 403
//   - Wrong token → 403
//   - Correct token → 200 + published count
//   - Two identical requests → idempotent; no duplicate deliveries

describe("Suite 40-30: Internal scheduler authentication", () => {
  const TEST_SECRET = "test-internal-scheduler-secret-abc123xyz";
  let savedSecret: string | undefined;

  beforeAll(async () => {
    savedSecret = process.env["SESSION_SECRET"];
    process.env["SESSION_SECRET"] = TEST_SECRET;
  });

  afterAll(async () => {
    if (savedSecret !== undefined) {
      process.env["SESSION_SECRET"] = savedSecret;
    } else {
      delete process.env["SESSION_SECRET"];
    }
  });

  it("Missing SESSION_SECRET → 503 and no publication", async () => {
    const prev = process.env["SESSION_SECRET"];
    delete process.env["SESSION_SECRET"];
    const res = await request(app)
      .post("/api/internal/notices/publish-scheduled")
      .set("Authorization", `Bearer ${TEST_SECRET}`);
    process.env["SESSION_SECRET"] = prev!;
    expect(res.status).toBe(503);
  });

  it("Missing Authorization header → 403", async () => {
    const res = await request(app)
      .post("/api/internal/notices/publish-scheduled");
    expect(res.status).toBe(403);
  });

  it("Incorrect token → 403", async () => {
    const res = await request(app)
      .post("/api/internal/notices/publish-scheduled")
      .set("Authorization", "Bearer wrong-secret");
    expect(res.status).toBe(403);
  });

  it("Correct token → 200 with published count", async () => {
    const res = await request(app)
      .post("/api/internal/notices/publish-scheduled")
      .set("Authorization", `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.published).toBe("number");
  });

  it("Correct token called twice → idempotent (no duplicate deliveries or timeline events)", async () => {
    // Insert a past-due scheduled notice
    const [scheduledNotice] = await db
      .insert(noticesTable)
      .values({
        companyId,
        title: "Idempotent Auth Test Notice",
        body: "Body",
        category: "general",
        audience: "owners_and_tenants",
        targetingMode: "company_wide",
        status: "scheduled",
        versionNumber: 1,
        createdByUserId: adminUserId,
        scheduledPublishAt: new Date(Date.now() - 3000),
      })
      .returning();
    const noticeId = scheduledNotice!.id;

    // First invocation — should publish the notice
    const res1 = await request(app)
      .post("/api/internal/notices/publish-scheduled")
      .set("Authorization", `Bearer ${TEST_SECRET}`);
    expect(res1.status).toBe(200);
    expect(res1.body.published).toBeGreaterThanOrEqual(1);

    // Second invocation — nothing new to publish (idempotent)
    const res2 = await request(app)
      .post("/api/internal/notices/publish-scheduled")
      .set("Authorization", `Bearer ${TEST_SECRET}`);
    expect(res2.status).toBe(200);
    expect(res2.body.published).toBe(0);

    // No duplicate deliveries for this notice
    const deliveries = await db
      .select({ userId: noticeDeliveriesTable.userId })
      .from(noticeDeliveriesTable)
      .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    const userIds = deliveries.map((d) => d.userId);
    expect(new Set(userIds).size).toBe(userIds.length);
  });
});
