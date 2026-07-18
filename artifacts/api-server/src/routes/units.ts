import { Router } from "express";
import { and, count, eq, ne, sql } from "drizzle-orm";
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
  getActivePricingConfig,
  getCompanyPricingOverride,
  calculateTier,
  calculateEstimatedAmountCents,
  getCurrentBillingMonth,
} from "../lib/billing";

const router = Router();

// ── Helper: update monthly usage after unit count changes ─────────────────────
//
// BILLING PEAK FIX (Issue 1):
//   Tier and estimated amount must be calculated from the monthly peak —
//   the highest simultaneous active count reached this month — NOT the
//   current active count.  When archiving apartments the active count falls,
//   but the peak must never decrease.
//
//   Implementation:
//     1. When an existing open record exists, compute the effective new peak
//        as Math.max(existing.peakActiveUnitCount, currentActiveCount).
//     2. Pass that newPeak to calculateTier() and calculateEstimatedAmountCents().
//     3. The DB column is still updated atomically via GREATEST() to guard
//        against concurrent requests arriving between the read and the write.
//     4. Storing tier/estimate from the pre-computed newPeak is equivalent to
//        the GREATEST() result and avoids a second round-trip.

async function updateMonthlyUsage(
  companyId: string,
  currentActiveCount: number,
): Promise<void> {
  const billingMonth = getCurrentBillingMonth();

  let config;
  let override;
  try {
    config = await getActivePricingConfig(billingMonth);
    override = await getCompanyPricingOverride(companyId, billingMonth);
  } catch (err) {
    // No active pricing config — log and skip billing update.
    // The unit operation itself still succeeds.
    // An administrator must seed a pricing config before billing is calculated.
    console.error(
      `[billing] Cannot update monthly usage for company ${companyId}: ${(err as Error).message}`,
    );
    return;
  }

  // Check for existing open record
  const [existing] = await db
    .select()
    .from(monthlyUsageRecordsTable)
    .where(
      and(
        eq(monthlyUsageRecordsTable.companyId, companyId),
        eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.invoiceStatus === "finalised") {
      // Finalised records must not be recalculated
      return;
    }

    // PEAK FIX: compute the new peak explicitly so tier/estimate are peak-based.
    // Using Math.max here is safe: the DB GREATEST() below handles any race
    // where another request incremented the peak concurrently between our
    // SELECT and UPDATE.  In that race the DB stores the higher value but
    // our tier/estimate calculation may be slightly stale — the next call will
    // correct it.  This is acceptable: the peak never decreases within a month.
    const newPeak = Math.max(existing.peakActiveUnitCount, currentActiveCount);
    const tier = calculateTier(newPeak, config, override);
    const estimated = calculateEstimatedAmountCents(newPeak, config, override);
    const rate = override?.customRatePerUnitCents ?? config.ratePerUnitCents;

    // Atomic GREATEST() update prevents race conditions in concurrent requests
    await db
      .update(monthlyUsageRecordsTable)
      .set({
        activeUnitCount: currentActiveCount,
        peakActiveUnitCount: sql`GREATEST(${monthlyUsageRecordsTable.peakActiveUnitCount}, ${currentActiveCount})`,
        subscriptionTier: tier,
        ratePerUnitCents: rate,
        estimatedAmountCents: estimated,
        pricingConfigId: config.id,
        companyOverrideId: override?.id ?? null,
        snapshotFreeUnitLimit: config.freeUnitLimit,
        snapshotStandardMin: config.standardMin,
        snapshotStandardMax: config.standardMax,
        snapshotEnterpriseStart: config.enterpriseStart,
        snapshotRatePerUnitCents: config.ratePerUnitCents,
        snapshotEnterpriseBehavior: config.enterprisePricingBehavior,
        snapshotCurrency: config.currency,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(monthlyUsageRecordsTable.companyId, companyId),
          eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
          ne(monthlyUsageRecordsTable.invoiceStatus, "finalised"),
        ),
      );
  } else {
    // New record: peak equals current count (first observation this month)
    const tier = calculateTier(currentActiveCount, config, override);
    const estimated = calculateEstimatedAmountCents(currentActiveCount, config, override);
    const rate = override?.customRatePerUnitCents ?? config.ratePerUnitCents;

    await db
      .insert(monthlyUsageRecordsTable)
      .values({
        companyId,
        billingMonth,
        activeUnitCount: currentActiveCount,
        peakActiveUnitCount: currentActiveCount,
        subscriptionTier: tier,
        ratePerUnitCents: rate,
        estimatedAmountCents: estimated,
        invoiceStatus: "open",
        pricingConfigId: config.id,
        companyOverrideId: override?.id ?? null,
        snapshotFreeUnitLimit: config.freeUnitLimit,
        snapshotStandardMin: config.standardMin,
        snapshotStandardMax: config.standardMax,
        snapshotEnterpriseStart: config.enterpriseStart,
        snapshotRatePerUnitCents: config.ratePerUnitCents,
        snapshotEnterpriseBehavior: config.enterprisePricingBehavior,
        snapshotCurrency: config.currency,
      })
      .onConflictDoNothing();
  }

  // Update company tier for display (derived from DB config, not hardcoded).
  // Use the peak-based tier so that archiving does not downgrade the displayed tier.
  const peakForCompany = existing
    ? Math.max(existing.peakActiveUnitCount, currentActiveCount)
    : currentActiveCount;
  const companyTier = calculateTier(peakForCompany, config, override);

  await db
    .update(companiesTable)
    .set({
      subscriptionTier: companyTier,
      enterpriseFlagged: companyTier === "enterprise",
      updatedAt: new Date(),
    })
    .where(eq(companiesTable.id, companyId));
}

// ── Helper: count active apartments for a company ─────────────────────────────
// Only unit_type = 'apartment' counts toward billing

async function countActiveApartments(companyId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(unitsTable)
    .where(
      and(
        eq(unitsTable.companyId, companyId),
        eq(unitsTable.status, "active"),
        eq(unitsTable.unitType, "apartment"),
      ),
    );
  return Number(result?.count ?? 0);
}

// ── Helper: verify admin access for a unit ────────────────────────────────────

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
    const buildingId = req.params["buildingId"] as string;

    const { unitNumber, unitType, floor } = req.body as {
      unitNumber?: string;
      unitType?: "apartment" | "garage" | "commercial" | "other";
      floor?: number;
    };

    if (!unitNumber?.trim()) {
      res.status(400).json({ error: "Unit number is required" });
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

      // M1: enforce companyId consistency — unit must belong to the building's company
      const isAdmin = await requireUnitAdmin(authReq.user.id, building);
      if (!isAdmin) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      const [unit] = await db
        .insert(unitsTable)
        .values({
          companyId: building.companyId, // M1: always use building's companyId
          buildingId,
          unitNumber: unitNumber.trim(),
          unitType: unitType ?? "apartment",
          floor: floor ?? null,
          status: "active",
          activatedAt: new Date(),
        })
        .returning();

      // Update billing only for apartments
      if (unit.unitType === "apartment") {
        const activeCount = await countActiveApartments(building.companyId);
        await updateMonthlyUsage(building.companyId, activeCount);
      }

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
  const unitId = req.params["unitId"] as string;

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

    // Admin access
    const isAdmin = await requireUnitAdmin(authReq.user.id, unit);
    if (isAdmin) {
      res.json(unit);
      return;
    }

    // C3 FIX: archived units do not grant owner/tenant access
    if (unit.status !== "active") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Owner/tenant with active membership on this active unit
    const [membership] = await db
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

    if (!membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(unit);
  } catch (err) {
    req.log.error({ err }, "GET /units/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /units/:unitId ──────────────────────────────────────────────────────

router.patch("/units/:unitId", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const unitId = req.params["unitId"] as string;

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

    const { unitNumber, unitType, floor } = req.body as {
      unitNumber?: string;
      unitType?: "apartment" | "garage" | "commercial" | "other";
      floor?: number | null;
    };

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

router.post(
  "/units/:unitId/archive",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const unitId = req.params["unitId"] as string;

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

      // Update billing — archiving drops active count but never lowers peak
      // (GREATEST() in updateMonthlyUsage ensures peak is preserved)
      if (unit.unitType === "apartment") {
        const activeCount = await countActiveApartments(unit.companyId);
        await updateMonthlyUsage(unit.companyId, activeCount);
      }

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "POST /units/:id/archive error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /units/:unitId/restore ───────────────────────────────────────────────

router.post(
  "/units/:unitId/restore",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const unitId = req.params["unitId"] as string;

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
        .set({
          status: "active",
          activatedAt: now,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(unitsTable.id, unitId))
        .returning();

      // Update billing — count includes restored apartment, update peak if needed
      if (unit.unitType === "apartment") {
        const activeCount = await countActiveApartments(unit.companyId);
        await updateMonthlyUsage(unit.companyId, activeCount);
      }

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "POST /units/:id/restore error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
