import { Router } from "express";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  unitsTable,
  buildingsTable,
  unitMembershipsTable,
  companiesTable,
  companyMembershipsTable,
  monthlyUsageRecordsTable,
} from "@workspace/db";
import { requireAuth, resolveUser, type AuthenticatedRequest } from "../middlewares/auth";
import {
  calculateTier,
  calculateEstimatedAmountCents,
  getCurrentBillingMonth,
  DEFAULT_RATE_PER_UNIT_CENTS,
  STANDARD_MAX_UNITS,
} from "../lib/billing";

const router = Router();

// ── Helper: update monthly usage after unit count changes ────────────────────

async function updateMonthlyUsage(
  companyId: string,
  currentActiveCount: number,
): Promise<void> {
  const billingMonth = getCurrentBillingMonth();
  const rate = DEFAULT_RATE_PER_UNIT_CENTS;

  // Get or create the usage record for this month
  const existing = await db
    .select()
    .from(monthlyUsageRecordsTable)
    .where(
      and(
        eq(monthlyUsageRecordsTable.companyId, companyId),
        eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
      ),
    )
    .limit(1);

  const newPeak = Math.max(
    existing[0]?.peakActiveUnitCount ?? 0,
    currentActiveCount,
  );
  const tier = calculateTier(newPeak);
  const estimated = calculateEstimatedAmountCents(newPeak, rate, tier);

  // Flag enterprise if ≥ 50 active
  if (currentActiveCount > STANDARD_MAX_UNITS) {
    await db
      .update(companiesTable)
      .set({ enterpriseFlagged: true, subscriptionTier: "enterprise", updatedAt: new Date() })
      .where(eq(companiesTable.id, companyId));
  } else if (currentActiveCount >= 3) {
    await db
      .update(companiesTable)
      .set({ subscriptionTier: "standard", updatedAt: new Date() })
      .where(eq(companiesTable.id, companyId));
  } else {
    await db
      .update(companiesTable)
      .set({ subscriptionTier: "free", updatedAt: new Date() })
      .where(eq(companiesTable.id, companyId));
  }

  if (existing[0]) {
    await db
      .update(monthlyUsageRecordsTable)
      .set({
        activeUnitCount: currentActiveCount,
        peakActiveUnitCount: newPeak,
        subscriptionTier: tier,
        ratePerUnitCents: rate,
        estimatedAmountCents: estimated,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, companyId),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      );
  } else {
    await db.insert(monthlyUsageRecordsTable).values({
      companyId,
      billingMonth,
      activeUnitCount: currentActiveCount,
      peakActiveUnitCount: newPeak,
      subscriptionTier: tier,
      ratePerUnitCents: rate,
      estimatedAmountCents: estimated,
      invoiceStatus: "open",
    }).onConflictDoNothing();
  }
}

// ── Helper: count active units for a company ─────────────────────────────────

async function countActiveUnits(companyId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(unitsTable)
    .where(
      and(
        eq(unitsTable.companyId, companyId),
        eq(unitsTable.status, "active"),
      ),
    );
  return Number(result?.count ?? 0);
}

// ── Helper: verify admin access for a unit ───────────────────────────────────

async function requireUnitAdmin(
  userId: string,
  unit: { companyId: string },
): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(companyMembershipsTable)
    .where(
      and(
        eq(companyMembershipsTable.companyId, unit.companyId),
        eq(companyMembershipsTable.userId, userId),
      ),
    )
    .limit(1);
  return !!membership;
}

// ── POST /buildings/:buildingId/units ─────────────────────────────────────────

router.post(
  "/buildings/:buildingId/units",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const buildingId = req.params.buildingId as string;
    const { unitNumber, unitType, floor } = req.body as {
      unitNumber?: string;
      unitType?: "apartment" | "garage" | "commercial" | "other";
      floor?: number | null;
    };

    if (!unitNumber?.trim()) {
      res.status(400).json({ error: "Apartment number is required" });
      return;
    }

    try {
      const [building] = await db
        .select()
        .from(buildingsTable)
        .where(eq(buildingsTable.id, buildingId))
        .limit(1);

      if (!building) {
        res.status(404).json({ error: "Building not found" });
        return;
      }

      const isAdmin = await requireUnitAdmin(authReq.user.id, building);
      if (!isAdmin) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      const now = new Date();
      const [unit] = await db
        .insert(unitsTable)
        .values({
          companyId: building.companyId,
          buildingId,
          unitNumber: unitNumber.trim(),
          unitType: unitType ?? "apartment",
          floor: floor ?? null,
          status: "active",
          activatedAt: now,
        })
        .returning();

      // Update billing peak (new active unit)
      const activeCount = await countActiveUnits(building.companyId);
      await updateMonthlyUsage(building.companyId, activeCount);

      res.status(201).json(unit);
    } catch (err) {
      req.log.error({ err }, "POST /buildings/:id/units error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /units/:unitId ────────────────────────────────────────────────────────

router.get("/units/:unitId", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const unitId = req.params.unitId as string;

  try {
    const [unit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId))
      .limit(1);

    if (!unit) {
      res.status(404).json({ error: "Apartment not found" });
      return;
    }

    const [building] = await db
      .select()
      .from(buildingsTable)
      .where(eq(buildingsTable.id, unit.buildingId))
      .limit(1);

    // Authorization: admin of the company OR owner/tenant of this unit
    const isAdmin = await requireUnitAdmin(authReq.user.id, unit);
    const [userMembership] = await db
      .select()
      .from(unitMembershipsTable)
      .where(
        and(
          eq(unitMembershipsTable.unitId, unitId),
          eq(unitMembershipsTable.userId, authReq.user.id),
          eq(unitMembershipsTable.status, "active"),
        ),
      )
      .limit(1);

    if (!isAdmin && !userMembership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Owner and tenant memberships
    const [owner] = await db
      .select()
      .from(unitMembershipsTable)
      .where(
        and(
          eq(unitMembershipsTable.unitId, unitId),
          eq(unitMembershipsTable.role, "owner"),
        ),
      )
      .orderBy(unitMembershipsTable.createdAt)
      .limit(1);

    const [tenant] = await db
      .select()
      .from(unitMembershipsTable)
      .where(
        and(
          eq(unitMembershipsTable.unitId, unitId),
          eq(unitMembershipsTable.role, "tenant"),
          eq(unitMembershipsTable.status, "active"),
        ),
      )
      .limit(1);

    res.json({
      ...unit,
      building: building ?? null,
      owner: owner ?? null,
      tenant: tenant ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "GET /units/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /units/:unitId ──────────────────────────────────────────────────────

router.patch("/units/:unitId", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const unitId = req.params.unitId as string;
  const { unitNumber, unitType, floor } = req.body as Partial<{
    unitNumber: string;
    unitType: "apartment" | "garage" | "commercial" | "other";
    floor: number | null;
  }>;

  try {
    const [unit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId))
      .limit(1);

    if (!unit) {
      res.status(404).json({ error: "Apartment not found" });
      return;
    }

    const isAdmin = await requireUnitAdmin(authReq.user.id, unit);
    if (!isAdmin) {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }

    const [updated] = await db
      .update(unitsTable)
      .set({
        ...(unitNumber !== undefined ? { unitNumber: unitNumber.trim() } : {}),
        ...(unitType !== undefined ? { unitType } : {}),
        ...(floor !== undefined ? { floor } : {}),
        updatedAt: new Date(),
      })
      .where(eq(unitsTable.id, unitId))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /units/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /units/:unitId/archive ───────────────────────────────────────────────

router.post("/units/:unitId/archive", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const unitId = req.params.unitId as string;

  try {
    const [unit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId))
      .limit(1);

    if (!unit) {
      res.status(404).json({ error: "Apartment not found" });
      return;
    }
    if (unit.status === "archived") {
      res.status(400).json({ error: "Apartment is already archived" });
      return;
    }

    const isAdmin = await requireUnitAdmin(authReq.user.id, unit);
    if (!isAdmin) {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(unitsTable)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(eq(unitsTable.id, unitId))
      .returning();

    // Update active count (peak is NOT reduced on archive)
    const activeCount = await countActiveUnits(unit.companyId);
    // Only update activeUnitCount, don't change peak
    const billingMonth = getCurrentBillingMonth();
    await db
      .update(monthlyUsageRecordsTable)
      .set({
        activeUnitCount: activeCount,
        updatedAt: now,
      })
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, unit.companyId),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
        ),
      );

    // Update company tier based on current active count (not peak)
    // Peak-based tier stays; active-count tier only affects current display
    if (activeCount <= 2) {
      await db.update(companiesTable).set({ subscriptionTier: "free", updatedAt: now })
        .where(eq(companiesTable.id, unit.companyId));
    } else if (activeCount <= STANDARD_MAX_UNITS) {
      await db.update(companiesTable).set({ subscriptionTier: "standard", updatedAt: now })
        .where(eq(companiesTable.id, unit.companyId));
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "POST /units/:id/archive error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /units/:unitId/restore ───────────────────────────────────────────────

router.post("/units/:unitId/restore", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const unitId = req.params.unitId as string;

  try {
    const [unit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId))
      .limit(1);

    if (!unit) {
      res.status(404).json({ error: "Apartment not found" });
      return;
    }
    if (unit.status === "active") {
      res.status(400).json({ error: "Apartment is already active" });
      return;
    }

    const isAdmin = await requireUnitAdmin(authReq.user.id, unit);
    if (!isAdmin) {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(unitsTable)
      .set({ status: "active", activatedAt: now, archivedAt: null, updatedAt: now })
      .where(eq(unitsTable.id, unitId))
      .returning();

    // Update billing — count includes restored unit, update peak if needed
    const activeCount = await countActiveUnits(unit.companyId);
    await updateMonthlyUsage(unit.companyId, activeCount);

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "POST /units/:id/restore error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
