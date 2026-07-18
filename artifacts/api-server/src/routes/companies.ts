import { Router } from "express";
import { and, count, eq, sql } from "drizzle-orm";
import {
  db,
  companiesTable,
  companyMembershipsTable,
  buildingsTable,
  unitsTable,
  unitMembershipsTable,
  monthlyUsageRecordsTable,
} from "@workspace/db";
import {
  requireAuth,
  resolveUser,
  type AuthenticatedRequest,
} from "../middlewares/auth";
import {
  resolveCompanyContext,
  requireAdmin,
  type CompanyRequest,
} from "../middlewares/company";
import {
  getActivePricingConfig,
  getCompanyPricingOverride,
  calculateTier,
  calculateEstimatedAmountCents,
  getCurrentBillingMonth,
} from "../lib/billing";

const router = Router();

// ── Helper: generate a unique slug ────────────────────────────────────────────

async function generateUniqueSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const [existing] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.slug, base))
    .limit(1);

  if (!existing) return base;

  // Append a short random suffix to avoid collision (M3 FIX)
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

// ── POST /companies ────────────────────────────────────────────────────────────

router.post("/companies", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { name } = req.body as { name?: string };

  if (!name?.trim()) {
    res.status(400).json({ error: "Company name is required" });
    return;
  }

  try {
    const slug = await generateUniqueSlug(name.trim());

    let company;
    try {
      [company] = await db
        .insert(companiesTable)
        .values({ name: name.trim(), slug })
        .returning();
    } catch (insertErr: unknown) {
      // M3 FIX: detect unique constraint violation on slug and return 409
      const pgErr = insertErr as { code?: string };
      if (pgErr?.code === "23505") {
        res.status(409).json({ error: "A company with this name already exists" });
        return;
      }
      throw insertErr;
    }

    // Add creator as administrator
    await db.insert(companyMembershipsTable).values({
      companyId: company.id,
      userId: authReq.user.id,
      role: "administrator",
    });

    res.status(201).json(company);
  } catch (err) {
    req.log.error({ err }, "POST /companies error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /companies ─────────────────────────────────────────────────────────────

router.get("/companies", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const memberships = await db
      .select({ company: companiesTable })
      .from(companyMembershipsTable)
      .innerJoin(
        companiesTable,
        eq(companyMembershipsTable.companyId, companiesTable.id),
      )
      .where(eq(companyMembershipsTable.userId, authReq.user.id));

    res.json(memberships.map((m) => m.company));
  } catch (err) {
    req.log.error({ err }, "GET /companies error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /companies/:companyId ──────────────────────────────────────────────────

router.get(
  "/companies/:companyId",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    res.json(companyReq.company);
  },
);

// ── PATCH /companies/:companyId ────────────────────────────────────────────────

router.patch(
  "/companies/:companyId",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const { name } = req.body as { name?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: "Company name is required" });
      return;
    }

    try {
      const [updated] = await db
        .update(companiesTable)
        .set({ name: name.trim(), updatedAt: new Date() })
        .where(eq(companiesTable.id, companyReq.company.id))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "PATCH /companies/:id error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/dashboard ───────────────────────────────────────

router.get(
  "/companies/:companyId/dashboard",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;

    try {
      const [buildingCount] = await db
        .select({ count: count() })
        .from(buildingsTable)
        .where(eq(buildingsTable.companyId, companyReq.company.id));

      const [unitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.companyId, companyReq.company.id),
            eq(unitsTable.status, "active"),
          ),
        );

      const [pendingInvitations] = await db
        .select({ count: count() })
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.companyId, companyReq.company.id),
            eq(unitMembershipsTable.status, "pending"),
          ),
        );

      res.json({
        buildingCount: Number(buildingCount?.count ?? 0),
        activeUnitCount: Number(unitCount?.count ?? 0),
        pendingInvitationCount: Number(pendingInvitations?.count ?? 0),
      });
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/dashboard error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/subscription ─────────────────────────────────────
// H4 FIX: reads pricing from DB; no hardcoded commercial constants.
// Issue 7 FIX: exposes explicit isCustomPricing field derived from
// enterprisePricingBehavior in the pricing config — do not infer from
// estimatedAmountCents === 0 in the frontend.

router.get(
  "/companies/:companyId/subscription",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;

    try {
      const billingMonth = getCurrentBillingMonth();

      // Active apartment count for billing
      const [activeUnitCountRow] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.companyId, companyReq.company.id),
            eq(unitsTable.status, "active"),
            eq(unitsTable.unitType, "apartment"),
          ),
        );

      // This month's usage record (peak)
      const [usage] = await db
        .select()
        .from(monthlyUsageRecordsTable)
        .where(
          and(
            eq(monthlyUsageRecordsTable.companyId, companyReq.company.id),
            eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
          ),
        )
        .limit(1);

      const activeUnitCount = Number(activeUnitCountRow?.count ?? 0);
      const peak = usage?.peakActiveUnitCount ?? activeUnitCount;

      // H4 FIX: read pricing config from DB
      let config;
      let override;
      try {
        config = await getActivePricingConfig(billingMonth);
        override = await getCompanyPricingOverride(
          companyReq.company.id,
          billingMonth,
        );
      } catch {
        // No pricing config seeded yet — return minimal response
        res.json({
          currentPlan: companyReq.company.subscriptionTier,
          activeUnitCount,
          peakActiveUnitCount: peak,
          ratePerUnitCents: null,
          estimatedAmountCents: null,
          billingMonth,
          enterpriseFlagged: companyReq.company.enterpriseFlagged,
          freeUnitLimit: null,
          pricingConfigured: false,
          // No isCustomPricing when config is unavailable
          isCustomPricing: false,
        });
        return;
      }

      const tier = calculateTier(peak, config, override);
      const estimated = calculateEstimatedAmountCents(peak, config, override);
      const rate = override?.customRatePerUnitCents ?? config.ratePerUnitCents;
      const freeLimit = override?.customFreeUnitLimit ?? config.freeUnitLimit;

      // Issue 7 FIX: derive isCustomPricing explicitly from the pricing config.
      // This replaces the fragile inference of (plan === 'enterprise' && amount === 0)
      // in the frontend.  Enterprise/fixed with fixed_rate=0 is NOT custom pricing.
      const isCustomPricing =
        tier === "enterprise" && config.enterprisePricingBehavior === "custom";

      res.json({
        currentPlan: tier,
        activeUnitCount,
        peakActiveUnitCount: peak,
        ratePerUnitCents: rate,
        estimatedAmountCents: estimated,
        billingMonth,
        enterpriseFlagged: companyReq.company.enterpriseFlagged,
        freeUnitLimit: freeLimit,
        pricingConfigured: true,
        isCustomPricing,
        enterprisePricingBehavior: config.enterprisePricingBehavior,
        snapshotConfig: {
          freeUnitLimit: config.freeUnitLimit,
          standardMin: config.standardMin,
          standardMax: config.standardMax,
          enterpriseStart: config.enterpriseStart,
          currency: config.currency,
        },
      });
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/subscription error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/usage ───────────────────────────────────────────
// Issue 7 FIX: each usage history row includes isCustomPricing derived from
// snapshotEnterpriseBehavior so that the frontend does not need to infer it.

router.get(
  "/companies/:companyId/usage",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;

    // M4 FIX: validate and bound the limit parameter
    const rawLimit = Number(req.query["limit"] ?? 12);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 36)
        : 12;

    try {
      const records = await db
        .select()
        .from(monthlyUsageRecordsTable)
        .where(eq(monthlyUsageRecordsTable.companyId, companyReq.company.id))
        .orderBy(sql`${monthlyUsageRecordsTable.billingMonth} DESC`)
        .limit(limit);

      // Issue 7 FIX: enrich each record with an explicit isCustomPricing flag
      // derived from snapshot data so the frontend never has to infer it.
      const enriched = records.map((r) => ({
        ...r,
        isCustomPricing:
          r.subscriptionTier === "enterprise" &&
          r.snapshotEnterpriseBehavior === "custom",
      }));

      res.json(enriched);
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/usage error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
