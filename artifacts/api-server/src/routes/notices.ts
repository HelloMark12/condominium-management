/**
 * Notices Routes — Module 2: Notices and Building Communication
 *
 * Admin routes (company-scoped, administrator-only):
 *   GET    /companies/:companyId/notices                         list
 *   POST   /companies/:companyId/notices                         create
 *   GET    /companies/:companyId/notices/:noticeId               detail
 *   PATCH  /companies/:companyId/notices/:noticeId               edit
 *   POST   /companies/:companyId/notices/:noticeId/publish        publish
 *   POST   /companies/:companyId/notices/:noticeId/schedule       schedule
 *   POST   /companies/:companyId/notices/:noticeId/archive        archive
 *   GET    /companies/:companyId/notices/:noticeId/versions       version history
 *   GET    /companies/:companyId/notices/:noticeId/delivery       delivery stats
 *
 * Resident routes (auth + user, no company context required):
 *   GET    /me/notices                    notice feed
 *   GET    /me/notices/unread-count       unread count
 *   GET    /me/notices/:noticeId          detail (marks as read)
 *   POST   /me/notices/:noticeId/read     explicit mark-as-read
 *   GET    /me/notices/:noticeId/tenant-delivery  owner → tenant delivery view
 *
 * Internal:
 *   POST   /internal/notices/publish-scheduled  trigger scheduled publishing
 */

import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  noticesTable,
  noticeBuildingTargetsTable,
  noticeUnitTargetsTable,
  noticeVersionsTable,
  noticeDeliveriesTable,
  noticeDeliveryContextsTable,
  buildingsTable,
  unitsTable,
  unitMembershipsTable,
  usersTable,
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
  publishNotice,
  publishScheduledNotices,
  editPublishedNotice,
} from "../lib/noticePublisher";

const router = Router();

// ── Shared validation helpers ──────────────────────────────────────────────────

const VALID_CATEGORIES = [
  "general",
  "emergency",
  "planned_maintenance",
  "cleaning",
  "lift",
  "agm_announcement",
  "other",
] as const;
type NoticeCategory = (typeof VALID_CATEGORIES)[number];

const VALID_AUDIENCES = [
  "owners_only",
  "tenants_only",
  "owners_and_tenants",
] as const;
type NoticeAudience = (typeof VALID_AUDIENCES)[number];

const VALID_TARGETING_MODES = ["company_wide", "buildings", "apartments"] as const;
type NoticeTargetingMode = (typeof VALID_TARGETING_MODES)[number];

function isValidCategory(v: unknown): v is NoticeCategory {
  return VALID_CATEGORIES.includes(v as NoticeCategory);
}
function isValidAudience(v: unknown): v is NoticeAudience {
  return VALID_AUDIENCES.includes(v as NoticeAudience);
}
function isValidTargetingMode(v: unknown): v is NoticeTargetingMode {
  return VALID_TARGETING_MODES.includes(v as NoticeTargetingMode);
}

/**
 * Validate that all building IDs belong to the given company, are active,
 * and are not archived. Returns a 400 payload or null if valid.
 */
async function validateBuildingTargets(
  companyId: string,
  buildingIds: string[],
): Promise<{ error: string } | null> {
  if (buildingIds.length === 0) return null;
  const rows = await db
    .select({ id: buildingsTable.id, status: buildingsTable.status })
    .from(buildingsTable)
    .where(
      and(
        inArray(buildingsTable.id, buildingIds),
        eq(buildingsTable.companyId, companyId),
      ),
    );
  if (rows.length !== buildingIds.length) {
    return { error: "One or more building IDs are invalid or belong to another company" };
  }
  const inactive = rows.filter((b) => b.status !== "active");
  if (inactive.length > 0) {
    return { error: "One or more targeted buildings are inactive" };
  }
  return null;
}

/**
 * Validate that all unit IDs belong to the given company and are active (not archived).
 */
async function validateUnitTargets(
  companyId: string,
  unitIds: string[],
): Promise<{ error: string } | null> {
  if (unitIds.length === 0) return null;
  const rows = await db
    .select({ id: unitsTable.id, status: unitsTable.status })
    .from(unitsTable)
    .where(
      and(
        inArray(unitsTable.id, unitIds),
        eq(unitsTable.companyId, companyId),
      ),
    );
  if (rows.length !== unitIds.length) {
    return { error: "One or more apartment IDs are invalid or belong to another company" };
  }
  const archived = rows.filter((u) => u.status === "archived");
  if (archived.length > 0) {
    return { error: "Archived apartments cannot be targeted" };
  }
  return null;
}

/** Insert target rows for a notice (idempotent via onConflictDoNothing). */
async function insertTargets(
  noticeId: string,
  companyId: string,
  buildingIds: string[],
  unitIds: string[],
): Promise<void> {
  if (buildingIds.length > 0) {
    await db
      .insert(noticeBuildingTargetsTable)
      .values(
        buildingIds.map((bid) => ({ noticeId, companyId, buildingId: bid })),
      )
      .onConflictDoNothing();
  }
  if (unitIds.length > 0) {
    await db
      .insert(noticeUnitTargetsTable)
      .values(unitIds.map((uid) => ({ noticeId, companyId, unitId: uid })))
      .onConflictDoNothing();
  }
}

/** Replace target rows (delete old, insert new) inside a transaction. */
async function replaceTargets(
  noticeId: string,
  companyId: string,
  buildingIds: string[],
  unitIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(noticeBuildingTargetsTable)
      .where(eq(noticeBuildingTargetsTable.noticeId, noticeId));
    await tx
      .delete(noticeUnitTargetsTable)
      .where(eq(noticeUnitTargetsTable.noticeId, noticeId));
    if (buildingIds.length > 0) {
      await tx
        .insert(noticeBuildingTargetsTable)
        .values(buildingIds.map((bid) => ({ noticeId, companyId, buildingId: bid })))
        .onConflictDoNothing();
    }
    if (unitIds.length > 0) {
      await tx
        .insert(noticeUnitTargetsTable)
        .values(unitIds.map((uid) => ({ noticeId, companyId, unitId: uid })))
        .onConflictDoNothing();
    }
  });
}

// Lazy trigger: run scheduled publishing when administrator accesses notices area
async function maybeRunScheduledPublishing(): Promise<void> {
  try {
    await publishScheduledNotices();
  } catch (err) {
    console.error("[notices] Lazy scheduled publish error:", err);
  }
}

// ── GET /companies/:companyId/notices ──────────────────────────────────────────

router.get(
  "/companies/:companyId/notices",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const companyId = companyReq.company.id;

    // Lazy scheduled publish check
    void maybeRunScheduledPublishing();

    const {
      status,
      category,
      audience,
      buildingId,
      unitId,
    } = req.query as {
      status?: string;
      category?: string;
      audience?: string;
      buildingId?: string;
      unitId?: string;
    };

    try {
      // Build base query
      const conditions = [eq(noticesTable.companyId, companyId)];

      if (status && status !== "all") {
        if (!["draft", "scheduled", "published", "archived"].includes(status)) {
          res.status(400).json({ error: "Invalid status filter" });
          return;
        }
        conditions.push(eq(noticesTable.status, status as "draft" | "scheduled" | "published" | "archived"));
      }
      if (category && isValidCategory(category)) {
        conditions.push(eq(noticesTable.category, category));
      }
      if (audience && isValidAudience(audience)) {
        conditions.push(eq(noticesTable.audience, audience));
      }

      let noticeIds: string[] | null = null;

      if (buildingId) {
        const bTargets = await db
          .select({ noticeId: noticeBuildingTargetsTable.noticeId })
          .from(noticeBuildingTargetsTable)
          .where(
            and(
              eq(noticeBuildingTargetsTable.buildingId, buildingId),
              eq(noticeBuildingTargetsTable.companyId, companyId),
            ),
          );
        noticeIds = bTargets.map((t) => t.noticeId);
      }

      if (unitId) {
        const uTargets = await db
          .select({ noticeId: noticeUnitTargetsTable.noticeId })
          .from(noticeUnitTargetsTable)
          .where(
            and(
              eq(noticeUnitTargetsTable.unitId, unitId),
              eq(noticeUnitTargetsTable.companyId, companyId),
            ),
          );
        const ids = uTargets.map((t) => t.noticeId);
        noticeIds = noticeIds === null ? ids : noticeIds.filter((id) => ids.includes(id));
      }

      if (noticeIds !== null && noticeIds.length === 0) {
        res.json([]);
        return;
      }
      if (noticeIds !== null) {
        conditions.push(inArray(noticesTable.id, noticeIds));
      }

      const notices = await db
        .select()
        .from(noticesTable)
        .where(and(...conditions))
        .orderBy(desc(noticesTable.createdAt));

      // Attach aggregate delivery stats per notice
      const result = await Promise.all(
        notices.map(async (notice) => {
          const [stats] = await db
            .select({
              total: count(),
              read: sql<number>`count(case when first_read_at is not null then 1 end)`,
            })
            .from(noticeDeliveriesTable)
            .where(eq(noticeDeliveriesTable.noticeId, notice.id));
          return {
            ...notice,
            deliveryStats: {
              totalRecipients: Number(stats?.total ?? 0),
              totalRead: Number(stats?.read ?? 0),
              readPercentage:
                Number(stats?.total ?? 0) > 0
                  ? Math.round(
                      (Number(stats?.read ?? 0) / Number(stats?.total ?? 0)) * 100,
                    )
                  : 0,
            },
          };
        }),
      );

      res.json(result);
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/notices error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /companies/:companyId/notices ─────────────────────────────────────────

router.post(
  "/companies/:companyId/notices",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const companyId = companyReq.company.id;
    const creatorId = companyReq.user.id;

    const {
      title,
      body,
      category,
      audience,
      targetingMode,
      buildingIds = [],
      unitIds = [],
      publishImmediately = false,
      scheduledPublishAt,
    } = req.body as {
      title?: string;
      body?: string;
      category?: string;
      audience?: string;
      targetingMode?: string;
      buildingIds?: string[];
      unitIds?: string[];
      publishImmediately?: boolean;
      scheduledPublishAt?: string;
    };

    // Validate required fields
    if (!title?.trim()) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (!body?.trim()) {
      res.status(400).json({ error: "Body is required" });
      return;
    }
    if (!isValidCategory(category)) {
      res.status(400).json({ error: "Valid category is required" });
      return;
    }
    if (!isValidAudience(audience)) {
      res.status(400).json({ error: "Valid audience is required" });
      return;
    }
    if (!isValidTargetingMode(targetingMode)) {
      res.status(400).json({ error: "Valid targetingMode is required" });
      return;
    }

    // Validate targets
    if (targetingMode === "buildings" && buildingIds.length === 0) {
      res.status(400).json({ error: "At least one building target is required" });
      return;
    }
    if (targetingMode === "apartments" && unitIds.length === 0) {
      res.status(400).json({ error: "At least one apartment target is required" });
      return;
    }

    const buildingValidation = await validateBuildingTargets(companyId, buildingIds);
    if (buildingValidation) {
      res.status(400).json(buildingValidation);
      return;
    }
    const unitValidation = await validateUnitTargets(companyId, unitIds);
    if (unitValidation) {
      res.status(400).json(unitValidation);
      return;
    }

    // Scheduled: validate date is in the future
    let scheduledAt: Date | null = null;
    if (scheduledPublishAt && !publishImmediately) {
      scheduledAt = new Date(scheduledPublishAt);
      if (isNaN(scheduledAt.getTime())) {
        res.status(400).json({ error: "Invalid scheduledPublishAt date" });
        return;
      }
      if (scheduledAt <= new Date()) {
        res.status(400).json({
          error: "Scheduled publication time must be in the future",
        });
        return;
      }
    }

    try {
      const [notice] = await db
        .insert(noticesTable)
        .values({
          companyId,
          title: title.trim(),
          body: body.trim(),
          category,
          audience,
          targetingMode,
          status: "draft",
          versionNumber: 1,
          createdByUserId: creatorId,
          scheduledPublishAt: scheduledAt,
        })
        .returning();

      await insertTargets(notice!.id, companyId, buildingIds, unitIds);

      if (publishImmediately) {
        const result = await publishNotice(notice!.id, creatorId);
        const [published] = await db
          .select()
          .from(noticesTable)
          .where(eq(noticesTable.id, notice!.id))
          .limit(1);
        res.status(201).json({ ...published, publishResult: result });
        return;
      }

      if (scheduledAt) {
        await db
          .update(noticesTable)
          .set({ status: "scheduled", scheduledPublishAt: scheduledAt, updatedAt: new Date() })
          .where(eq(noticesTable.id, notice!.id));
        const [scheduled] = await db
          .select()
          .from(noticesTable)
          .where(eq(noticesTable.id, notice!.id))
          .limit(1);
        res.status(201).json(scheduled);
        return;
      }

      res.status(201).json(notice);
    } catch (err) {
      req.log.error({ err }, "POST /companies/:id/notices error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/notices/:noticeId ────────────────────────────────

router.get(
  "/companies/:companyId/notices/:noticeId",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }

      const [buildingTargets, unitTargets] = await Promise.all([
        db
          .select({ buildingId: noticeBuildingTargetsTable.buildingId })
          .from(noticeBuildingTargetsTable)
          .where(eq(noticeBuildingTargetsTable.noticeId, noticeId)),
        db
          .select({ unitId: noticeUnitTargetsTable.unitId })
          .from(noticeUnitTargetsTable)
          .where(eq(noticeUnitTargetsTable.noticeId, noticeId)),
      ]);

      res.json({
        ...notice,
        buildingIds: buildingTargets.map((t) => t.buildingId),
        unitIds: unitTargets.map((t) => t.unitId),
      });
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/notices/:noticeId error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /companies/:companyId/notices/:noticeId ─────────────────────────────

router.patch(
  "/companies/:companyId/notices/:noticeId",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;
    const editorId = companyReq.user.id;

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }

      if (notice.status === "archived") {
        res.status(400).json({ error: "Archived notices cannot be edited" });
        return;
      }

      const { title, body, category, audience, targetingMode,
              buildingIds, unitIds, scheduledPublishAt, editReason } = req.body as {
        title?: string;
        body?: string;
        category?: string;
        audience?: string;
        targetingMode?: string;
        buildingIds?: string[];
        unitIds?: string[];
        scheduledPublishAt?: string | null;
        editReason?: string;
      };

      // Published notice editing goes through the versioned path
      if (notice.status === "published") {
        if (!title && !body && !category) {
          res.status(400).json({ error: "No editable fields provided" });
          return;
        }
        const updated = await editPublishedNotice(
          noticeId,
          editorId,
          { title, body, category },
          editReason,
        );
        res.json(updated);
        return;
      }

      // Draft / Scheduled: free edit
      if (category && !isValidCategory(category)) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
      if (audience && !isValidAudience(audience)) {
        res.status(400).json({ error: "Invalid audience" });
        return;
      }
      const targetMode = targetingMode ?? notice.targetingMode;
      if (targetingMode && !isValidTargetingMode(targetingMode)) {
        res.status(400).json({ error: "Invalid targetingMode" });
        return;
      }

      const newBuildingIds = buildingIds ?? [];
      const newUnitIds = unitIds ?? [];

      if (targetMode === "buildings" && newBuildingIds.length === 0 && buildingIds !== undefined) {
        res.status(400).json({ error: "At least one building target is required" });
        return;
      }
      if (targetMode === "apartments" && newUnitIds.length === 0 && unitIds !== undefined) {
        res.status(400).json({ error: "At least one apartment target is required" });
        return;
      }

      if (buildingIds !== undefined) {
        const v = await validateBuildingTargets(companyId, newBuildingIds);
        if (v) { res.status(400).json(v); return; }
      }
      if (unitIds !== undefined) {
        const v = await validateUnitTargets(companyId, newUnitIds);
        if (v) { res.status(400).json(v); return; }
      }

      let newScheduledAt: Date | null | undefined = undefined;
      if (scheduledPublishAt !== undefined) {
        if (scheduledPublishAt === null) {
          newScheduledAt = null;
        } else {
          newScheduledAt = new Date(scheduledPublishAt);
          if (isNaN(newScheduledAt.getTime())) {
            res.status(400).json({ error: "Invalid scheduledPublishAt" });
            return;
          }
          if (newScheduledAt <= new Date()) {
            res.status(400).json({ error: "Scheduled publication must be in the future" });
            return;
          }
        }
      }

      const updateFields: Record<string, unknown> = { updatedAt: new Date(), updatedByUserId: editorId };
      if (title !== undefined) updateFields["title"] = title.trim();
      if (body !== undefined) updateFields["body"] = body.trim();
      if (category !== undefined) updateFields["category"] = category;
      if (audience !== undefined) updateFields["audience"] = audience;
      if (targetingMode !== undefined) updateFields["targetingMode"] = targetingMode;
      if (newScheduledAt !== undefined) updateFields["scheduledPublishAt"] = newScheduledAt;

      await db.update(noticesTable).set(updateFields).where(eq(noticesTable.id, noticeId));

      if (buildingIds !== undefined || unitIds !== undefined) {
        await replaceTargets(
          noticeId,
          companyId,
          buildingIds ?? [],
          unitIds ?? [],
        );
      }

      const [updated] = await db
        .select()
        .from(noticesTable)
        .where(eq(noticesTable.id, noticeId))
        .limit(1);
      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "PATCH /companies/:id/notices/:noticeId error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /companies/:companyId/notices/:noticeId/publish ───────────────────────

router.post(
  "/companies/:companyId/notices/:noticeId/publish",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }
      if (notice.status === "published") {
        res.status(400).json({ error: "Notice is already published" });
        return;
      }
      if (notice.status === "archived") {
        res.status(400).json({ error: "Archived notices cannot be published" });
        return;
      }

      const result = await publishNotice(noticeId, companyReq.user.id);
      const [published] = await db
        .select()
        .from(noticesTable)
        .where(eq(noticesTable.id, noticeId))
        .limit(1);

      res.json({ ...published, publishResult: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      req.log.error({ err }, "POST /notices/:id/publish error");
      res.status(500).json({ error: msg });
    }
  },
);

// ── POST /companies/:companyId/notices/:noticeId/schedule ──────────────────────

router.post(
  "/companies/:companyId/notices/:noticeId/schedule",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;
    const { scheduledPublishAt } = req.body as { scheduledPublishAt?: string };

    if (!scheduledPublishAt) {
      res.status(400).json({ error: "scheduledPublishAt is required" });
      return;
    }
    const scheduledAt = new Date(scheduledPublishAt);
    if (isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "Invalid scheduledPublishAt date" });
      return;
    }
    if (scheduledAt <= new Date()) {
      res.status(400).json({ error: "Scheduled publication must be in the future" });
      return;
    }

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }
      if (!["draft", "scheduled"].includes(notice.status)) {
        res.status(400).json({
          error: "Only draft or scheduled notices can be rescheduled",
        });
        return;
      }

      const [updated] = await db
        .update(noticesTable)
        .set({
          status: "scheduled",
          scheduledPublishAt: scheduledAt,
          updatedAt: new Date(),
          updatedByUserId: companyReq.user.id,
        })
        .where(eq(noticesTable.id, noticeId))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "POST /notices/:id/schedule error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /companies/:companyId/notices/:noticeId/archive ───────────────────────

router.post(
  "/companies/:companyId/notices/:noticeId/archive",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }
      if (notice.status === "archived") {
        res.status(400).json({ error: "Notice is already archived" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(noticesTable)
        .set({
          status: "archived",
          archivedAt: now,
          updatedAt: now,
          updatedByUserId: companyReq.user.id,
        })
        .where(eq(noticesTable.id, noticeId))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "POST /notices/:id/archive error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/notices/:noticeId/versions ───────────────────────

router.get(
  "/companies/:companyId/notices/:noticeId/versions",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;

    try {
      const [notice] = await db
        .select({ id: noticesTable.id })
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }

      const versions = await db
        .select({
          id: noticeVersionsTable.id,
          versionNumber: noticeVersionsTable.versionNumber,
          title: noticeVersionsTable.title,
          body: noticeVersionsTable.body,
          category: noticeVersionsTable.category,
          audience: noticeVersionsTable.audience,
          targetingSnapshot: noticeVersionsTable.targetingSnapshot,
          editedByUserId: noticeVersionsTable.editedByUserId,
          editReason: noticeVersionsTable.editReason,
          createdAt: noticeVersionsTable.createdAt,
          editorName: usersTable.fullName,
        })
        .from(noticeVersionsTable)
        .leftJoin(usersTable, eq(usersTable.id, noticeVersionsTable.editedByUserId))
        .where(eq(noticeVersionsTable.noticeId, noticeId))
        .orderBy(desc(noticeVersionsTable.versionNumber));

      res.json(versions);
    } catch (err) {
      req.log.error({ err }, "GET /notices/:id/versions error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /companies/:companyId/notices/:noticeId/delivery ───────────────────────

router.get(
  "/companies/:companyId/notices/:noticeId/delivery",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const noticeId = req.params["noticeId"] as string;
    const companyId = companyReq.company.id;

    try {
      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            eq(noticesTable.companyId, companyId),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }

      // Aggregate stats
      const [stats] = await db
        .select({
          totalRecipients: count(),
          totalRead: sql<number>`count(case when first_read_at is not null then 1 end)`,
          ownersCount: sql<number>`count(case when recipient_role = 'owner' then 1 end)`,
          tenantsCount: sql<number>`count(case when recipient_role = 'tenant' then 1 end)`,
        })
        .from(noticeDeliveriesTable)
        .where(
          and(
            eq(noticeDeliveriesTable.noticeId, noticeId),
            eq(noticeDeliveriesTable.companyId, companyId),
          ),
        );

      // Distinct targeted buildings
      const targetBuildings = await db
        .select({ buildingId: noticeBuildingTargetsTable.buildingId })
        .from(noticeBuildingTargetsTable)
        .where(eq(noticeBuildingTargetsTable.noticeId, noticeId));

      const targetUnits = await db
        .select({ unitId: noticeUnitTargetsTable.unitId })
        .from(noticeUnitTargetsTable)
        .where(eq(noticeUnitTargetsTable.noticeId, noticeId));

      // Detailed delivery list
      const deliveries = await db
        .select({
          deliveryId: noticeDeliveriesTable.id,
          userId: noticeDeliveriesTable.userId,
          recipientRole: noticeDeliveriesTable.recipientRole,
          deliveredAt: noticeDeliveriesTable.deliveredAt,
          firstReadAt: noticeDeliveriesTable.firstReadAt,
          lastReadAt: noticeDeliveriesTable.lastReadAt,
          userName: usersTable.fullName,
          userEmail: usersTable.email,
        })
        .from(noticeDeliveriesTable)
        .leftJoin(usersTable, eq(usersTable.id, noticeDeliveriesTable.userId))
        .where(
          and(
            eq(noticeDeliveriesTable.noticeId, noticeId),
            eq(noticeDeliveriesTable.companyId, companyId),
          ),
        )
        .orderBy(desc(noticeDeliveriesTable.deliveredAt));

      // Enrich each delivery with its contexts (building/unit)
      const enrichedDeliveries = await Promise.all(
        deliveries.map(async (d) => {
          const contexts = await db
            .select({
              buildingId: noticeDeliveryContextsTable.buildingId,
              unitId: noticeDeliveryContextsTable.unitId,
              buildingName: buildingsTable.name,
              unitNumber: unitsTable.unitNumber,
            })
            .from(noticeDeliveryContextsTable)
            .leftJoin(
              buildingsTable,
              eq(buildingsTable.id, noticeDeliveryContextsTable.buildingId),
            )
            .leftJoin(
              unitsTable,
              eq(unitsTable.id, noticeDeliveryContextsTable.unitId),
            )
            .where(
              eq(noticeDeliveryContextsTable.deliveryId, d.deliveryId),
            );
          return { ...d, contexts };
        }),
      );

      const totalRecipients = Number(stats?.totalRecipients ?? 0);
      const totalRead = Number(stats?.totalRead ?? 0);

      res.json({
        summary: {
          targetedBuildings: targetBuildings.length,
          targetedApartments: targetUnits.length,
          totalRecipients,
          ownersDelivered: Number(stats?.ownersCount ?? 0),
          tenantsDelivered: Number(stats?.tenantsCount ?? 0),
          totalRead,
          totalUnread: totalRecipients - totalRead,
          readPercentage:
            totalRecipients > 0
              ? Math.round((totalRead / totalRecipients) * 100)
              : 0,
        },
        deliveries: enrichedDeliveries,
      });
    } catch (err) {
      req.log.error({ err }, "GET /notices/:id/delivery error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /me/notices ────────────────────────────────────────────────────────────

router.get("/me/notices", requireAuth, resolveUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.id;

  const { unreadOnly, category, buildingId, unitId, includeArchived } =
    req.query as {
      unreadOnly?: string;
      category?: string;
      buildingId?: string;
      unitId?: string;
      includeArchived?: string;
    };

  try {
    // Run lazy scheduled publishing
    void maybeRunScheduledPublishing();

    // Get all deliveries for this user
    const deliveryConditions = [eq(noticeDeliveriesTable.userId, userId)];
    if (unreadOnly === "true") {
      deliveryConditions.push(isNull(noticeDeliveriesTable.firstReadAt));
    }

    const deliveries = await db
      .select({
        deliveryId: noticeDeliveriesTable.id,
        noticeId: noticeDeliveriesTable.noticeId,
        recipientRole: noticeDeliveriesTable.recipientRole,
        deliveredAt: noticeDeliveriesTable.deliveredAt,
        firstReadAt: noticeDeliveriesTable.firstReadAt,
        lastReadAt: noticeDeliveriesTable.lastReadAt,
        lastReadVersion: noticeDeliveriesTable.lastReadVersion,
      })
      .from(noticeDeliveriesTable)
      .where(and(...deliveryConditions));

    if (deliveries.length === 0) {
      res.json([]);
      return;
    }

    let noticeIds = deliveries.map((d) => d.noticeId);

    // Filter by buildingId or unitId via delivery contexts
    if (buildingId || unitId) {
      const contextConditions = [
        inArray(noticeDeliveryContextsTable.deliveryId, deliveries.map((d) => d.deliveryId)),
      ];
      if (buildingId) {
        contextConditions.push(eq(noticeDeliveryContextsTable.buildingId, buildingId));
      }
      if (unitId) {
        contextConditions.push(eq(noticeDeliveryContextsTable.unitId, unitId));
      }
      const matchingContexts = await db
        .select({ deliveryId: noticeDeliveryContextsTable.deliveryId })
        .from(noticeDeliveryContextsTable)
        .where(and(...contextConditions));
      const matchingDeliveryIds = new Set(matchingContexts.map((c) => c.deliveryId));
      const filteredDeliveries = deliveries.filter((d) =>
        matchingDeliveryIds.has(d.deliveryId),
      );
      noticeIds = filteredDeliveries.map((d) => d.noticeId);
    }

    if (noticeIds.length === 0) {
      res.json([]);
      return;
    }

    // Build notice filter
    const noticeConditions = [inArray(noticesTable.id, noticeIds)];
    noticeConditions.push(
      includeArchived === "true"
        ? or(
            eq(noticesTable.status, "published"),
            eq(noticesTable.status, "archived"),
          )!
        : eq(noticesTable.status, "published"),
    );
    if (category && isValidCategory(category)) {
      noticeConditions.push(eq(noticesTable.category, category));
    }

    const notices = await db
      .select()
      .from(noticesTable)
      .where(and(...noticeConditions));

    // Build delivery map
    const deliveryMap = new Map(deliveries.map((d) => [d.noticeId, d]));

    // Merge notice + delivery
    const feed = notices.map((notice) => {
      const delivery = deliveryMap.get(notice.id);
      const isRead = !!delivery?.firstReadAt;
      // Emergency: unread if lastReadVersion is null (reset by edit) or never read
      const isUnread =
        notice.category === "emergency"
          ? !delivery?.lastReadVersion || delivery.lastReadVersion < notice.versionNumber
          : !isRead;

      return {
        ...notice,
        delivery: {
          id: delivery?.deliveryId,
          recipientRole: delivery?.recipientRole,
          deliveredAt: delivery?.deliveredAt,
          firstReadAt: delivery?.firstReadAt,
          lastReadAt: delivery?.lastReadAt,
          lastReadVersion: delivery?.lastReadVersion,
          isRead,
          isUnread,
        },
      };
    });

    // Sort: unread emergency → other unread → read by newest published
    feed.sort((a, b) => {
      const aIsUnread = a.delivery.isUnread;
      const bIsUnread = b.delivery.isUnread;
      const aIsEmergency = a.category === "emergency";
      const bIsEmergency = b.category === "emergency";

      if (aIsUnread && aIsEmergency && !(bIsUnread && bIsEmergency)) return -1;
      if (bIsUnread && bIsEmergency && !(aIsUnread && aIsEmergency)) return 1;
      if (aIsUnread && !bIsUnread) return -1;
      if (bIsUnread && !aIsUnread) return 1;
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    });

    res.json(feed);
  } catch (err) {
    req.log.error({ err }, "GET /me/notices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /me/notices/unread-count ───────────────────────────────────────────────

router.get(
  "/me/notices/unread-count",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.id;

    try {
      // A notice is unread when:
      //   - lastReadVersion is null  (never read, or reset by an emergency edit)
      //   - lastReadVersion < notice.versionNumber  (a newer version exists)
      // Using version comparison is reliable for all notice types, including
      // emergency notices whose lastReadVersion is reset to null on edit.
      const unreadNotices = await db
        .select({
          noticeId: noticeDeliveriesTable.noticeId,
          lastReadVersion: noticeDeliveriesTable.lastReadVersion,
          noticeVersionNumber: noticesTable.versionNumber,
        })
        .from(noticeDeliveriesTable)
        .innerJoin(noticesTable, eq(noticesTable.id, noticeDeliveriesTable.noticeId))
        .where(
          and(
            eq(noticeDeliveriesTable.userId, userId),
            eq(noticesTable.status, "published"),
          ),
        );

      const unreadCount = unreadNotices.filter(
        (row) =>
          row.lastReadVersion === null ||
          row.lastReadVersion < row.noticeVersionNumber,
      ).length;

      res.json({ unreadCount });
    } catch (err) {
      req.log.error({ err }, "GET /me/notices/unread-count error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /me/notices/:noticeId — detail + mark as read ─────────────────────────

router.get(
  "/me/notices/:noticeId",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const noticeId = req.params["noticeId"] as string;
    const userId = authReq.user.id;

    try {
      // Find delivery for this user
      const [delivery] = await db
        .select()
        .from(noticeDeliveriesTable)
        .where(
          and(
            eq(noticeDeliveriesTable.noticeId, noticeId),
            eq(noticeDeliveriesTable.userId, userId),
          ),
        )
        .limit(1);

      if (!delivery) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const [notice] = await db
        .select()
        .from(noticesTable)
        .where(
          and(
            eq(noticesTable.id, noticeId),
            or(
              eq(noticesTable.status, "published"),
              eq(noticesTable.status, "archived"),
            ),
          ),
        )
        .limit(1);

      if (!notice) {
        res.status(404).json({ error: "Notice not found" });
        return;
      }

      // Mark as read
      const now = new Date();
      await db
        .update(noticeDeliveriesTable)
        .set({
          firstReadAt: delivery.firstReadAt ?? now,
          lastReadAt: now,
          lastReadVersion: notice.versionNumber,
        })
        .where(eq(noticeDeliveriesTable.id, delivery.id));

      res.json({
        ...notice,
        delivery: {
          recipientRole: delivery.recipientRole,
          deliveredAt: delivery.deliveredAt,
          firstReadAt: delivery.firstReadAt ?? now,
          lastReadAt: now,
          lastReadVersion: notice.versionNumber,
          isRead: true,
          isUnread: false,
        },
      });
    } catch (err) {
      req.log.error({ err }, "GET /me/notices/:id error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /me/notices/:noticeId/read ───────────────────────────────────────────

router.post(
  "/me/notices/:noticeId/read",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const noticeId = req.params["noticeId"] as string;
    const userId = authReq.user.id;

    try {
      const [delivery] = await db
        .select()
        .from(noticeDeliveriesTable)
        .where(
          and(
            eq(noticeDeliveriesTable.noticeId, noticeId),
            eq(noticeDeliveriesTable.userId, userId),
          ),
        )
        .limit(1);

      if (!delivery) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const [notice] = await db
        .select({ versionNumber: noticesTable.versionNumber })
        .from(noticesTable)
        .where(eq(noticesTable.id, noticeId))
        .limit(1);

      const now = new Date();
      await db
        .update(noticeDeliveriesTable)
        .set({
          firstReadAt: delivery.firstReadAt ?? now,
          lastReadAt: now,
          lastReadVersion: notice?.versionNumber ?? 1,
        })
        .where(eq(noticeDeliveriesTable.id, delivery.id));

      res.json({ success: true });
    } catch (err) {
      req.log.error({ err }, "POST /me/notices/:id/read error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /me/notices/:noticeId/tenant-delivery ─────────────────────────────────
// An owner may see tenant delivery status for apartments they actively own.
// The owner does NOT need to be a recipient of the notice personally —
// this allows owners to see tenant delivery for tenants-only notices.

router.get(
  "/me/notices/:noticeId/tenant-delivery",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const noticeId = req.params["noticeId"] as string;
    const userId = authReq.user.id;

    try {
      // Gate: the caller must have at least one active ownership of an active apartment.
      // Revoked, archived, or tenant memberships are excluded.
      const ownedUnitRows = await db
        .select({ unitId: unitMembershipsTable.unitId })
        .from(unitMembershipsTable)
        .innerJoin(unitsTable, eq(unitsTable.id, unitMembershipsTable.unitId))
        .where(
          and(
            eq(unitMembershipsTable.userId, userId),
            eq(unitMembershipsTable.role, "owner"),
            eq(unitMembershipsTable.status, "active"),
            eq(unitsTable.status, "active"),
          ),
        );

      const ownedUnitIds = ownedUnitRows.map((r) => r.unitId);

      if (ownedUnitIds.length === 0) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // Find tenant delivery contexts for this notice that go through the
      // owner's apartments.  Tenant contexts for apartments the caller does
      // not own are excluded by the inArray filter.
      const tenantContexts = await db
        .select({
          deliveryId: noticeDeliveryContextsTable.deliveryId,
          unitId: noticeDeliveryContextsTable.unitId,
          unitNumber: unitsTable.unitNumber,
        })
        .from(noticeDeliveryContextsTable)
        .innerJoin(
          noticeDeliveriesTable,
          eq(noticeDeliveriesTable.id, noticeDeliveryContextsTable.deliveryId),
        )
        .innerJoin(unitsTable, eq(unitsTable.id, noticeDeliveryContextsTable.unitId))
        .where(
          and(
            eq(noticeDeliveriesTable.noticeId, noticeId),
            eq(noticeDeliveryContextsTable.relationshipRole, "tenant"),
            inArray(noticeDeliveryContextsTable.unitId, ownedUnitIds),
          ),
        );

      if (tenantContexts.length === 0) {
        res.json([]);
        return;
      }

      const tenantDeliveryResults = await Promise.all(
        tenantContexts.map(async (ctx) => {
          const [tenantDelivery] = await db
            .select({
              firstReadAt: noticeDeliveriesTable.firstReadAt,
              lastReadAt: noticeDeliveriesTable.lastReadAt,
              tenantName: usersTable.fullName,
            })
            .from(noticeDeliveriesTable)
            .leftJoin(usersTable, eq(usersTable.id, noticeDeliveriesTable.userId))
            .where(eq(noticeDeliveriesTable.id, ctx.deliveryId))
            .limit(1);

          return {
            unitId: ctx.unitId,
            unitNumber: ctx.unitNumber,
            delivered: !!tenantDelivery,
            isRead: !!tenantDelivery?.firstReadAt,
            firstReadAt: tenantDelivery?.firstReadAt ?? null,
            tenantName: tenantDelivery?.tenantName ?? null,
          };
        }),
      );

      res.json(tenantDeliveryResults);
    } catch (err) {
      req.log.error({ err }, "GET /me/notices/:id/tenant-delivery error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /internal/notices/publish-scheduled ───────────────────────────────────
// For scheduled job invocation. No external auth — should be network-isolated.

router.post("/internal/notices/publish-scheduled", async (req, res) => {
  // Fail closed: SESSION_SECRET MUST be configured.
  // An unconfigured secret means any caller could trigger publication.
  const secret = process.env["SESSION_SECRET"];
  if (!secret?.trim()) {
    res.status(503).json({ error: "Service not configured" });
    return;
  }

  // Require a Bearer token header
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const provided = authHeader.slice(7); // strip "Bearer "

  // Timing-safe comparison prevents secret-length oracle attacks
  const secretBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  let isValid = false;
  if (secretBuf.length === providedBuf.length) {
    isValid = timingSafeEqual(secretBuf, providedBuf);
  }

  if (!isValid) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const count = await publishScheduledNotices();
    res.json({ published: count });
  } catch (err) {
    req.log.error({ err }, "POST /internal/notices/publish-scheduled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
