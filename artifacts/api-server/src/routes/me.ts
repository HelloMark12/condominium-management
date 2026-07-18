import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  unitMembershipsTable,
  unitsTable,
  buildingsTable,
  companiesTable,
} from "@workspace/db";
import { requireAuth, resolveUser, type AuthenticatedRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /me/units
 * All active apartments owned by the current user (across all companies).
 * C3 FIX: only units with status = 'active' are returned.
 */
router.get("/me/units", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const rows = await db
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
        and(
          eq(unitMembershipsTable.userId, authReq.user.id),
          eq(unitMembershipsTable.role, "owner"),
          eq(unitMembershipsTable.status, "active"),
          eq(unitsTable.status, "active"), // C3 FIX: archived units do not grant access
        ),
      );

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /me/units error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /me/tenancy
 * The current user's active tenancy (null if not a tenant anywhere).
 * C3 FIX: only units with status = 'active' are returned.
 */
router.get("/me/tenancy", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const rows = await db
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
        and(
          eq(unitMembershipsTable.userId, authReq.user.id),
          eq(unitMembershipsTable.role, "tenant"),
          eq(unitMembershipsTable.status, "active"),
          eq(unitsTable.status, "active"), // C3 FIX: archived units do not grant access
        ),
      )
      .limit(1);

    res.json(rows[0] ?? null);
  } catch (err) {
    req.log.error({ err }, "GET /me/tenancy error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
