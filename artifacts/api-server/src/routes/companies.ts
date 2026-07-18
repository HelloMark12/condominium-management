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
  pricingConfigTable,
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
  calculateTier,
  calculateEstimatedAmountCents,
  getCurrentBillingMonth,
  DEFAULT_RATE_PER_UNIT_CENTS,
  FREE_UNIT_LIMIT,
} from "../lib/billing";

const router = Router();

/**
 * POST /companies
 * Register a new condominium administration company.
 * The authenticated user becomes the first administrator.
 */
router.post(
  "/companies",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const { name } = req.body as { name?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: "Company name is required" });
      return;
    }

    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const [company] = await db
        .insert(companiesTable)
        .values({ name: name.trim(), slug })
        .returning();

      await db.insert(companyMembershipsTable).values({
        companyId: company.id,
        userId: authReq.user.id,
        role: "administrator",
      });

      // Initialise the first monthly usage record
      const billingMonth = getCurrentBillingMonth();
      const rate = DEFAULT_RATE_PER_UNIT_CENTS;
      await db.insert(monthlyUsageRecordsTable).values({
        companyId: company.id,
        billingMonth,
        activeUnitCount: 0,
        peakActiveUnitCount: 0,
        subscriptionTier: "free",
        ratePerUnitCents: rate,
        estimatedAmountCents: 0,
        invoiceStatus: "open",
      }).onConflictDoNothing();

      res.status(201).json(company);
    } catch (err) {
      req.log.error({ err }, "POST /companies error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /companies/:companyId
 */
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

/**
 * PATCH /companies/:companyId
 */
router.patch(
  "/companies/:companyId",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const { name } = req.body as { name?: string };

    try {
      const [updated] = await db
        .update(companiesTable)
        .set({
          ...(name ? { name: name.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(companiesTable.id, companyReq.company.id))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "PATCH /companies error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /companies/:companyId/dashboard
 * Administrator dashboard summary.
 */
router.get(
  "/companies/:companyId/dashboard",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const companyId = companyReq.company.id;

    try {
      const [buildingCount] = await db
        .select({ count: count() })
        .from(buildingsTable)
        .where(eq(buildingsTable.companyId, companyId));

      const [activeUnitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.companyId, companyId),
            eq(unitsTable.status, "active"),
          ),
        );

      const [archivedUnitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.companyId, companyId),
            eq(unitsTable.status, "archived"),
          ),
        );

      const [activeOwnerCount] = await db
        .select({ count: count() })
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.companyId, companyId),
            eq(unitMembershipsTable.role, "owner"),
            eq(unitMembershipsTable.status, "active"),
          ),
        );

      const [activeTenantCount] = await db
        .select({ count: count() })
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.companyId, companyId),
            eq(unitMembershipsTable.role, "tenant"),
            eq(unitMembershipsTable.status, "active"),
          ),
        );

      const [pendingOwnerCount] = await db
        .select({ count: count() })
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.companyId, companyId),
            eq(unitMembershipsTable.role, "owner"),
            eq(unitMembershipsTable.status, "pending"),
          ),
        );

      const [pendingTenantCount] = await db
        .select({ count: count() })
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.companyId, companyId),
            eq(unitMembershipsTable.role, "tenant"),
            eq(unitMembershipsTable.status, "pending"),
          ),
        );

      // Current billing month usage
      const billingMonth = getCurrentBillingMonth();
      const [usageRecord] = await db
        .select()
        .from(monthlyUsageRecordsTable)
        .where(
          and(
            eq(monthlyUsageRecordsTable.companyId, companyId),
            eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
          ),
        )
        .limit(1);

      const peak = usageRecord?.peakActiveUnitCount ?? 0;
      const tier = calculateTier(peak);
      const rate = usageRecord?.ratePerUnitCents ?? DEFAULT_RATE_PER_UNIT_CENTS;
      const estimated = calculateEstimatedAmountCents(peak, rate, tier);

      res.json({
        totalBuildings: Number(buildingCount?.count ?? 0),
        totalActiveUnits: Number(activeUnitCount?.count ?? 0),
        totalArchivedUnits: Number(archivedUnitCount?.count ?? 0),
        totalActiveOwners: Number(activeOwnerCount?.count ?? 0),
        totalActiveTenants: Number(activeTenantCount?.count ?? 0),
        pendingOwnerInvitations: Number(pendingOwnerCount?.count ?? 0),
        pendingTenantInvitations: Number(pendingTenantCount?.count ?? 0),
        currentPlan: tier,
        estimatedMonthlyChargeCents: estimated,
        peakActiveUnitCount: peak,
      });
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/dashboard error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /companies/:companyId/subscription
 * Administrator only — billing information.
 */
router.get(
  "/companies/:companyId/subscription",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const companyId = companyReq.company.id;

    try {
      const billingMonth = getCurrentBillingMonth();
      const [usageRecord] = await db
        .select()
        .from(monthlyUsageRecordsTable)
        .where(
          and(
            eq(monthlyUsageRecordsTable.companyId, companyId),
            eq(monthlyUsageRecordsTable.billingMonth, billingMonth),
          ),
        )
        .limit(1);

      const [activeUnitCount] = await db
        .select({ count: count() })
        .from(unitsTable)
        .where(
          and(
            eq(unitsTable.companyId, companyId),
            eq(unitsTable.status, "active"),
          ),
        );

      const peak = usageRecord?.peakActiveUnitCount ?? 0;
      const tier = calculateTier(peak);
      const rate = usageRecord?.ratePerUnitCents ?? DEFAULT_RATE_PER_UNIT_CENTS;
      const estimated = calculateEstimatedAmountCents(peak, rate, tier);

      res.json({
        currentPlan: tier,
        activeUnitCount: Number(activeUnitCount?.count ?? 0),
        peakActiveUnitCount: peak,
        ratePerUnitCents: rate,
        estimatedAmountCents: estimated,
        billingMonth,
        enterpriseFlagged: companyReq.company.enterpriseFlagged,
        freeUnitLimit: FREE_UNIT_LIMIT,
      });
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/subscription error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /companies/:companyId/usage
 * Monthly usage history — administrator only.
 */
router.get(
  "/companies/:companyId/usage",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const limit = Math.min(Number(req.query["limit"] ?? 12), 36);

    try {
      const records = await db
        .select()
        .from(monthlyUsageRecordsTable)
        .where(eq(monthlyUsageRecordsTable.companyId, companyReq.company.id))
        .orderBy(sql`${monthlyUsageRecordsTable.billingMonth} DESC`)
        .limit(limit);

      res.json(records);
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/usage error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
