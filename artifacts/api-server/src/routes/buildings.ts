import { Router } from "express";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  buildingsTable,
  unitsTable,
  companyMembershipsTable,
  unitMembershipsTable,
} from "@workspace/db";
import { requireAuth, resolveUser } from "../middlewares/auth";
import {
  resolveCompanyContext,
  requireAdmin,
  type CompanyRequest,
} from "../middlewares/company";
import type { AuthenticatedRequest } from "../middlewares/auth";

const router = Router();

// ── C1 FIX: shared building-access helper ─────────────────────────────────────
/**
 * Returns true if the user is:
 *   (a) an administrator of the building's company, OR
 *   (b) an owner or tenant with an active apartment in this building.
 *
 * Returns the building row so callers avoid a second DB round-trip.
 */
async function resolveAndAuthorizeBuilding(
  userId: string,
  buildingId: string,
): Promise<{ building: typeof buildingsTable.$inferSelect; authorized: boolean }> {
  const [building] = await db
    .select()
    .from(buildingsTable)
    .where(eq(buildingsTable.id, buildingId))
    .limit(1);

  if (!building) return { building: null as never, authorized: false };

  // (a) Company admin
  const [adminMembership] = await db
    .select()
    .from(companyMembershipsTable)
    .where(
      and(
        eq(companyMembershipsTable.companyId, building.companyId),
        eq(companyMembershipsTable.userId, userId),
      ),
    )
    .limit(1);

  if (adminMembership) return { building, authorized: true };

  // (b) Active owner/tenant with an active apartment in this building
  const [unitMembership] = await db
    .select({ id: unitMembershipsTable.id })
    .from(unitMembershipsTable)
    .innerJoin(unitsTable, eq(unitMembershipsTable.unitId, unitsTable.id))
    .where(
      and(
        eq(unitMembershipsTable.userId, userId),
        eq(unitMembershipsTable.status, "active"),
        eq(unitsTable.buildingId, buildingId),
        eq(unitsTable.status, "active"),
        eq(unitsTable.unitType, "apartment"),
      ),
    )
    .limit(1);

  return { building, authorized: !!unitMembership };
}

// ── GET /companies/:companyId/buildings ────────────────────────────────────────

router.get(
  "/companies/:companyId/buildings",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  async (req, res) => {
    const companyReq = req as CompanyRequest;

    try {
      const buildings = await db
        .select()
        .from(buildingsTable)
        .where(eq(buildingsTable.companyId, companyReq.company.id))
        .orderBy(buildingsTable.name);

      res.json(buildings);
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/buildings error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /companies/:companyId/buildings ───────────────────────────────────────

router.post(
  "/companies/:companyId/buildings",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const {
      name,
      addressLine1,
      addressLine2,
      locality,
      postcode,
      country,
      status,
    } = req.body as {
      name?: string;
      addressLine1?: string;
      addressLine2?: string;
      locality?: string;
      postcode?: string;
      country?: string;
      status?: "active" | "inactive";
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Building name is required" });
      return;
    }
    if (!locality?.trim()) {
      res.status(400).json({ error: "Locality is required" });
      return;
    }

    try {
      const [building] = await db
        .insert(buildingsTable)
        .values({
          companyId: companyReq.company.id,
          name: name.trim(),
          addressLine1: addressLine1 ?? null,
          addressLine2: addressLine2 ?? null,
          locality: locality.trim(),
          postcode: postcode ?? null,
          country: country ?? "MT",
          status: status ?? "active",
        })
        .returning();

      res.status(201).json(building);
    } catch (err) {
      req.log.error({ err }, "POST /companies/:id/buildings error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /buildings/:buildingId ─────────────────────────────────────────────────
// C1 FIX: authorization enforced via resolveAndAuthorizeBuilding

router.get(
  "/buildings/:buildingId",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const buildingId = req.params["buildingId"] as string;

    try {
      const { building, authorized } = await resolveAndAuthorizeBuilding(
        authReq.user.id,
        buildingId,
      );

      if (!building) {
        res.status(404).json({ error: "Building not found" });
        return;
      }
      if (!authorized) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const [activeUnitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.buildingId, buildingId),
            eq(unitsTable.status, "active"),
          ),
        );

      const [archivedUnitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.buildingId, buildingId),
            eq(unitsTable.status, "archived"),
          ),
        );

      res.json({
        ...building,
        activeUnitCount: Number(activeUnitCount?.count ?? 0),
        archivedUnitCount: Number(archivedUnitCount?.count ?? 0),
      });
    } catch (err) {
      req.log.error({ err }, "GET /buildings/:id error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /buildings/:buildingId ───────────────────────────────────────────────
// C1 FIX: authorization enforced; admin-only write operation

router.patch(
  "/buildings/:buildingId",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const buildingId = req.params["buildingId"] as string;

    try {
      const { building, authorized } = await resolveAndAuthorizeBuilding(
        authReq.user.id,
        buildingId,
      );

      if (!building) {
        res.status(404).json({ error: "Building not found" });
        return;
      }
      if (!authorized) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // PATCH is a write operation — must be company admin
      const [adminMembership] = await db
        .select()
        .from(companyMembershipsTable)
        .where(
          and(
            eq(companyMembershipsTable.companyId, building.companyId),
            eq(companyMembershipsTable.userId, authReq.user.id),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      const {
        name,
        addressLine1,
        addressLine2,
        locality,
        postcode,
        country,
        status,
      } = req.body as {
        name?: string;
        addressLine1?: string;
        addressLine2?: string;
        locality?: string;
        postcode?: string;
        country?: string;
        status?: "active" | "inactive";
      };

      const [updated] = await db
        .update(buildingsTable)
        .set({
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(addressLine1 !== undefined ? { addressLine1 } : {}),
          ...(addressLine2 !== undefined ? { addressLine2 } : {}),
          ...(locality !== undefined ? { locality: locality.trim() } : {}),
          ...(postcode !== undefined ? { postcode } : {}),
          ...(country !== undefined ? { country } : {}),
          ...(status !== undefined ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(buildingsTable.id, buildingId))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "PATCH /buildings/:id error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /buildings/:buildingId/units ───────────────────────────────────────────
// C1 FIX: authorization enforced via resolveAndAuthorizeBuilding

router.get(
  "/buildings/:buildingId/units",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const buildingId = req.params["buildingId"] as string;
    const statusFilter = req.query["status"] as string | undefined;

    try {
      const { building, authorized } = await resolveAndAuthorizeBuilding(
        authReq.user.id,
        buildingId,
      );

      if (!building) {
        res.status(404).json({ error: "Building not found" });
        return;
      }
      if (!authorized) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const conditions = [eq(unitsTable.buildingId, buildingId)];
      if (statusFilter === "active") {
        conditions.push(eq(unitsTable.status, "active"));
      } else if (statusFilter === "archived") {
        conditions.push(eq(unitsTable.status, "archived"));
      }

      const units = await db
        .select()
        .from(unitsTable)
        .where(and(...conditions))
        .orderBy(unitsTable.unitNumber);

      res.json(units);
    } catch (err) {
      req.log.error({ err }, "GET /buildings/:id/units error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
