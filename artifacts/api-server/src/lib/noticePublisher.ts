/**
 * Notice Publisher Service — Module 2
 *
 * Handles atomic notice publication and scheduled notice processing.
 * Designed so automated tests can invoke publishNotice() and
 * publishScheduledNotices() directly without going through HTTP.
 *
 * All publication happens inside a single PostgreSQL transaction.
 * If any step fails the transaction rolls back — no partial publish.
 */

import { and, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import {
  db,
  noticesTable,
  noticeBuildingTargetsTable,
  noticeUnitTargetsTable,
  noticeVersionsTable,
  noticeDeliveriesTable,
  noticeDeliveryContextsTable,
  buildingTimelineEventsTable,
  buildingsTable,
  unitsTable,
  unitMembershipsTable,
} from "@workspace/db";
import type { Notice } from "@workspace/db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PublishResult {
  noticeId: string;
  recipientCount: number;
  buildingCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Current time in Europe/Malta. Returns a JS Date (UTC internally). */
function maltaNow(): Date {
  return new Date();
}

/** Check whether a scheduled_publish_at is in the past (Malta time = UTC). */
function isPastDue(scheduledAt: Date): boolean {
  return scheduledAt <= maltaNow();
}

// ── Core publish logic ─────────────────────────────────────────────────────────

/**
 * Publish a single notice atomically.
 *
 * Valid pre-states: draft | scheduled
 * The caller must already hold administrator rights for the notice's company.
 *
 * @param noticeId   UUID of the notice to publish
 * @param publisherId UUID of the user performing the action (logged in version)
 * @returns PublishResult with recipient count
 * @throws Error with descriptive message if publish cannot proceed
 */
export async function publishNotice(
  noticeId: string,
  publisherId: string,
): Promise<PublishResult> {
  return await db.transaction(async (tx) => {
    // ── 1. Load notice ────────────────────────────────────────────────────────
    const [notice] = await tx
      .select()
      .from(noticesTable)
      .where(eq(noticesTable.id, noticeId))
      .limit(1);

    if (!notice) {
      throw new Error(`Notice ${noticeId} not found`);
    }

    if (notice.status === "published") {
      throw new Error("Notice is already published");
    }
    if (notice.status === "archived") {
      throw new Error("Archived notices cannot be published");
    }

    // ── 2. Resolve building set from targeting mode ──────────────────────────
    let targetedBuildingIds: string[] = [];
    let targetedUnitIds: string[] = [];

    if (notice.targetingMode === "company_wide") {
      // All active buildings in the company
      const buildings = await tx
        .select({ id: buildingsTable.id })
        .from(buildingsTable)
        .where(
          and(
            eq(buildingsTable.companyId, notice.companyId),
            eq(buildingsTable.status, "active"),
          ),
        );
      targetedBuildingIds = buildings.map((b) => b.id);
    } else if (notice.targetingMode === "buildings") {
      const targets = await tx
        .select({ buildingId: noticeBuildingTargetsTable.buildingId })
        .from(noticeBuildingTargetsTable)
        .where(eq(noticeBuildingTargetsTable.noticeId, noticeId));
      targetedBuildingIds = targets.map((t) => t.buildingId);
    } else {
      // apartments mode — units must belong to their buildings
      const targets = await tx
        .select({
          unitId: noticeUnitTargetsTable.unitId,
          buildingId: unitsTable.buildingId,
        })
        .from(noticeUnitTargetsTable)
        .innerJoin(unitsTable, eq(unitsTable.id, noticeUnitTargetsTable.unitId))
        .where(eq(noticeUnitTargetsTable.noticeId, noticeId));
      targetedUnitIds = targets.map((t) => t.unitId);
      // Unique buildings from the targeted units
      const uniqueBuildings = [...new Set(targets.map((t) => t.buildingId))];
      targetedBuildingIds = uniqueBuildings;
    }

    // ── 3. Resolve active apartments in the target set ───────────────────────
    // These are the apartments whose owners / tenants may receive the notice.
    let eligibleUnits: { id: string; buildingId: string }[] = [];

    if (notice.targetingMode === "apartments") {
      // Only the explicitly listed, active units
      if (targetedUnitIds.length > 0) {
        eligibleUnits = await tx
          .select({ id: unitsTable.id, buildingId: unitsTable.buildingId })
          .from(unitsTable)
          .where(
            and(
              inArray(unitsTable.id, targetedUnitIds),
              eq(unitsTable.status, "active"),
              eq(unitsTable.companyId, notice.companyId),
            ),
          );
      }
    } else if (targetedBuildingIds.length > 0) {
      // All active units in the targeted buildings
      eligibleUnits = await tx
        .select({ id: unitsTable.id, buildingId: unitsTable.buildingId })
        .from(unitsTable)
        .where(
          and(
            inArray(unitsTable.buildingId, targetedBuildingIds),
            eq(unitsTable.status, "active"),
            eq(unitsTable.companyId, notice.companyId),
          ),
        );
    }

    const eligibleUnitIds = eligibleUnits.map((u) => u.id);

    // ── 4. Resolve eligible members by audience ──────────────────────────────
    type MemberRow = {
      userId: string;
      unitId: string;
      role: string;
    };
    let members: MemberRow[] = [];

    if (eligibleUnitIds.length > 0) {
      const roleFilter =
        notice.audience === "owners_only"
          ? eq(unitMembershipsTable.role, "owner")
          : notice.audience === "tenants_only"
            ? eq(unitMembershipsTable.role, "tenant")
            : or(
                eq(unitMembershipsTable.role, "owner"),
                eq(unitMembershipsTable.role, "tenant"),
              );

      const rows = await tx
        .select({
          userId: unitMembershipsTable.userId,
          unitId: unitMembershipsTable.unitId,
          role: unitMembershipsTable.role,
        })
        .from(unitMembershipsTable)
        .where(
          and(
            inArray(unitMembershipsTable.unitId, eligibleUnitIds),
            eq(unitMembershipsTable.status, "active"),
            isNotNull(unitMembershipsTable.userId),
            roleFilter,
          ),
        );
      // Filter out rows where userId is null (pending invitations not yet accepted)
      members = rows.filter((r) => r.userId !== null) as MemberRow[];
    }

    // ── 5. Deduplicate recipients by userId ──────────────────────────────────
    // A user who owns or rents multiple targeted apartments gets one delivery.
    const userDeliveryMap = new Map<
      string,
      { role: string; unitIds: string[] }
    >();
    for (const m of members) {
      const existing = userDeliveryMap.get(m.userId);
      if (!existing) {
        userDeliveryMap.set(m.userId, { role: m.role, unitIds: [m.unitId] });
      } else {
        existing.unitIds.push(m.unitId);
        // If a user is both owner and tenant (unlikely but possible), prefer 'owner'
        if (m.role === "owner") existing.role = "owner";
      }
    }

    const now = maltaNow();

    // ── 6. Create notice_deliveries ──────────────────────────────────────────
    const deliveryInserts: {
      noticeId: string;
      companyId: string;
      userId: string;
      recipientRole: string;
      deliveredAt: Date;
    }[] = [];

    for (const [userId, info] of userDeliveryMap) {
      deliveryInserts.push({
        noticeId,
        companyId: notice.companyId,
        userId,
        recipientRole: info.role,
        deliveredAt: now,
      });
    }

    let insertedDeliveries: { id: string; userId: string }[] = [];
    if (deliveryInserts.length > 0) {
      insertedDeliveries = await tx
        .insert(noticeDeliveriesTable)
        .values(deliveryInserts)
        .onConflictDoNothing()
        .returning({ id: noticeDeliveriesTable.id, userId: noticeDeliveriesTable.userId });
    }

    // Build userId → delivery ID map
    const deliveryIdMap = new Map(
      insertedDeliveries.map((d) => [d.userId, d.id]),
    );

    // ── 7. Create notice_delivery_contexts ───────────────────────────────────
    // Build a unit → building map for context rows
    const unitBuildingMap = new Map(
      eligibleUnits.map((u) => [u.id, u.buildingId]),
    );

    const contextInserts: {
      deliveryId: string;
      companyId: string;
      buildingId: string;
      unitId: string | null;
      relationshipRole: string;
    }[] = [];

    for (const m of members) {
      const deliveryId = deliveryIdMap.get(m.userId);
      if (!deliveryId) continue; // delivery may have been skipped (onConflict)
      const buildingId = unitBuildingMap.get(m.unitId);
      if (!buildingId) continue;
      contextInserts.push({
        deliveryId,
        companyId: notice.companyId,
        buildingId,
        unitId: m.unitId,
        relationshipRole: m.role,
      });
    }

    if (contextInserts.length > 0) {
      await tx
        .insert(noticeDeliveryContextsTable)
        .values(contextInserts)
        .onConflictDoNothing();
    }

    // ── 8. Update notice: status → published ─────────────────────────────────
    await tx
      .update(noticesTable)
      .set({
        status: "published",
        publishedAt: now,
        updatedByUserId: publisherId,
        updatedAt: now,
      })
      .where(eq(noticesTable.id, noticeId));

    // ── 9. Store initial notice_version snapshot ──────────────────────────────
    const buildingTargets = await tx
      .select({ buildingId: noticeBuildingTargetsTable.buildingId })
      .from(noticeBuildingTargetsTable)
      .where(eq(noticeBuildingTargetsTable.noticeId, noticeId));
    const unitTargets = await tx
      .select({ unitId: noticeUnitTargetsTable.unitId })
      .from(noticeUnitTargetsTable)
      .where(eq(noticeUnitTargetsTable.noticeId, noticeId));

    const targetingSnapshot = {
      targetingMode: notice.targetingMode,
      buildingIds: buildingTargets.map((t) => t.buildingId),
      unitIds: unitTargets.map((t) => t.unitId),
    };

    await tx
      .insert(noticeVersionsTable)
      .values({
        noticeId,
        companyId: notice.companyId,
        versionNumber: notice.versionNumber,
        title: notice.title,
        body: notice.body,
        category: notice.category,
        audience: notice.audience,
        targetingSnapshot,
        editedByUserId: publisherId,
      })
      .onConflictDoNothing();

    // ── 10. Building timeline events ──────────────────────────────────────────
    const buildingIdsForTimeline = [...new Set(targetedBuildingIds)];
    if (buildingIdsForTimeline.length > 0) {
      const timelineRows = buildingIdsForTimeline.map((buildingId) => ({
        companyId: notice.companyId,
        buildingId,
        eventType: "notice_published",
        noticeId,
        title: notice.title,
        summary: `${notice.category} notice published to ${notice.audience.replace(/_/g, " ")}`,
        metadata: {
          category: notice.category,
          audience: notice.audience,
          targetingMode: notice.targetingMode,
        },
        createdByUserId: publisherId,
        eventAt: now,
      }));

      // onConflictDoNothing handles the unique index on (buildingId, eventType, noticeId)
      await tx
        .insert(buildingTimelineEventsTable)
        .values(timelineRows)
        .onConflictDoNothing();
    }

    return {
      noticeId,
      recipientCount: insertedDeliveries.length,
      buildingCount: buildingIdsForTimeline.length,
    };
  });
}

// ── Scheduled publishing ───────────────────────────────────────────────────────

/**
 * Find all scheduled notices whose scheduled_publish_at is in the past and
 * publish them. Idempotent: safe to call multiple times.
 *
 * @returns count of notices published in this run
 */
export async function publishScheduledNotices(): Promise<number> {
  const now = maltaNow();

  // Load all scheduled notices that are past-due
  const duePending = await db
    .select({ id: noticesTable.id, createdByUserId: noticesTable.createdByUserId })
    .from(noticesTable)
    .where(
      and(
        eq(noticesTable.status, "scheduled"),
        lte(noticesTable.scheduledPublishAt, now),
      ),
    );

  let published = 0;
  for (const notice of duePending) {
    try {
      await publishNotice(notice.id, notice.createdByUserId);
      published++;
    } catch (err) {
      // Log and continue — one failing notice should not block others
      console.error(
        `[noticePublisher] Failed to publish scheduled notice ${notice.id}:`,
        err,
      );
    }
  }

  return published;
}

// ── Edit published notice ──────────────────────────────────────────────────────

/**
 * Edit a published notice. Increments version, stores version history,
 * and resets unread state for Emergency notices.
 *
 * @param noticeId   UUID of the notice
 * @param editorId   UUID of the administrator making the edit
 * @param changes    Fields to update (title, body, category)
 * @param editReason Optional reason stored in version history
 */
export async function editPublishedNotice(
  noticeId: string,
  editorId: string,
  changes: { title?: string; body?: string; category?: string },
  editReason?: string,
): Promise<Notice> {
  return await db.transaction(async (tx) => {
    const [notice] = await tx
      .select()
      .from(noticesTable)
      .where(eq(noticesTable.id, noticeId))
      .limit(1);

    if (!notice) throw new Error("Notice not found");
    if (notice.status !== "published") {
      throw new Error("Only published notices can be edited via this path");
    }

    const newVersion = notice.versionNumber + 1;

    // Snapshot current state before overwriting
    const buildingTargets = await tx
      .select({ buildingId: noticeBuildingTargetsTable.buildingId })
      .from(noticeBuildingTargetsTable)
      .where(eq(noticeBuildingTargetsTable.noticeId, noticeId));
    const unitTargets = await tx
      .select({ unitId: noticeUnitTargetsTable.unitId })
      .from(noticeUnitTargetsTable)
      .where(eq(noticeUnitTargetsTable.noticeId, noticeId));

    const targetingSnapshot = {
      targetingMode: notice.targetingMode,
      buildingIds: buildingTargets.map((t) => t.buildingId),
      unitIds: unitTargets.map((t) => t.unitId),
    };

    // Store version record with CURRENT (pre-edit) content
    await tx.insert(noticeVersionsTable).values({
      noticeId,
      companyId: notice.companyId,
      versionNumber: newVersion,
      title: changes.title ?? notice.title,
      body: changes.body ?? notice.body,
      category: (changes.category as typeof notice.category) ?? notice.category,
      audience: notice.audience,
      targetingSnapshot,
      editedByUserId: editorId,
      editReason: editReason ?? null,
    });

    const now = new Date();

    // Update the notice with new content
    const [updated] = await tx
      .update(noticesTable)
      .set({
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.body !== undefined ? { body: changes.body } : {}),
        ...(changes.category !== undefined
          ? { category: changes.category as typeof notice.category }
          : {}),
        versionNumber: newVersion,
        updatedByUserId: editorId,
        updatedAt: now,
      })
      .where(eq(noticesTable.id, noticeId))
      .returning();

    // Emergency notices: reset unread state so recipients see the update again
    if (
      notice.category === "emergency" ||
      changes.category === "emergency"
    ) {
      await tx
        .update(noticeDeliveriesTable)
        .set({
          // Preserve first_read_at (audit trail), but clear lastReadVersion
          // so the notice appears unread in the feed
          lastReadAt: null,
          lastReadVersion: null,
        })
        .where(eq(noticeDeliveriesTable.noticeId, noticeId));
    }

    return updated!;
  });
}
