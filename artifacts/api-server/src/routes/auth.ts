import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  companyMembershipsTable,
  companiesTable,
  unitMembershipsTable,
  unitsTable,
  buildingsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router = Router();

/**
 * POST /auth/sync
 * Upsert a local user record from the Clerk session.
 * Called immediately after Clerk sign-in.
 */
router.post("/auth/sync", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { email, fullName } = req.body as {
    email?: string;
    fullName?: string;
  };

  try {
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, authReq.clerkUserId))
      .limit(1);

    if (existing[0]) {
      // Update if email/name changed
      const [updated] = await db
        .update(usersTable)
        .set({
          email: email ?? existing[0].email,
          fullName: fullName ?? existing[0].fullName,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.clerkUserId, authReq.clerkUserId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(usersTable)
        .values({
          clerkUserId: authReq.clerkUserId,
          email: email ?? "",
          fullName: fullName ?? null,
        })
        .returning();
      res.json(created);
    }
  } catch (err) {
    req.log.error({ err }, "auth/sync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /auth/me
 * Returns the current user with company and unit context.
 */
router.get("/auth/me", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;

  try {
    // Find local user
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, authReq.clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found. Call /auth/sync first." });
      return;
    }

    // Admin companies
    const adminMemberships = await db
      .select({ company: companiesTable })
      .from(companyMembershipsTable)
      .innerJoin(
        companiesTable,
        eq(companyMembershipsTable.companyId, companiesTable.id),
      )
      .where(eq(companyMembershipsTable.userId, user.id));

    const adminCompanies = adminMemberships.map((m) => m.company);

    // Owned units (across all companies)
    const ownerMemberships = await db
      .select({
        membership: unitMembershipsTable,
        unit: unitsTable,
        building: buildingsTable,
        company: companiesTable,
      })
      .from(unitMembershipsTable)
      .innerJoin(unitsTable, eq(unitMembershipsTable.unitId, unitsTable.id))
      .innerJoin(buildingsTable, eq(unitsTable.buildingId, buildingsTable.id))
      .innerJoin(companiesTable, eq(unitsTable.companyId, companiesTable.id))
      .where(
        eq(unitMembershipsTable.userId, user.id),
      )
      .then((rows) =>
        rows.filter(
          (r) =>
            r.membership.role === "owner" && r.membership.status === "active",
        ),
      );

    // Active tenancy
    const tenancyRows = await db
      .select({
        membership: unitMembershipsTable,
        unit: unitsTable,
        building: buildingsTable,
        company: companiesTable,
      })
      .from(unitMembershipsTable)
      .innerJoin(unitsTable, eq(unitMembershipsTable.unitId, unitsTable.id))
      .innerJoin(buildingsTable, eq(unitsTable.buildingId, buildingsTable.id))
      .innerJoin(companiesTable, eq(unitsTable.companyId, companiesTable.id))
      .where(eq(unitMembershipsTable.userId, user.id))
      .then((rows) =>
        rows.filter(
          (r) =>
            r.membership.role === "tenant" && r.membership.status === "active",
        ),
      );

    const tenancy = tenancyRows[0] ?? null;

    res.json({
      user,
      adminCompanies,
      ownedUnits: ownerMemberships,
      tenancy,
    });
  } catch (err) {
    req.log.error({ err }, "auth/me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
