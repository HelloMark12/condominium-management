import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import { buildingsTable } from "./buildings";
import { unitsTable } from "./units";

// ── Enums ──────────────────────────────────────────────────────────────────────

export const noticeCategoryEnum = pgEnum("notice_category", [
  "general",
  "emergency",
  "planned_maintenance",
  "cleaning",
  "lift",
  "agm_announcement",
  "other",
]);

export const noticeStatusEnum = pgEnum("notice_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const noticeAudienceEnum = pgEnum("notice_audience", [
  "owners_only",
  "tenants_only",
  "owners_and_tenants",
]);

export const noticeTargetingModeEnum = pgEnum("notice_targeting_mode", [
  "company_wide",
  "buildings",
  "apartments",
]);

// ── notices ────────────────────────────────────────────────────────────────────

export const noticesTable = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: noticeCategoryEnum("category").notNull(),
    audience: noticeAudienceEnum("audience").notNull(),
    status: noticeStatusEnum("status").default("draft").notNull(),
    targetingMode: noticeTargetingModeEnum("targeting_mode").notNull(),
    scheduledPublishAt: timestamp("scheduled_publish_at", {
      withTimezone: true,
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    versionNumber: integer("version_number").default(1).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .references(() => usersTable.id)
      .notNull(),
    updatedByUserId: uuid("updated_by_user_id").references(
      () => usersTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    /** Company notice list filtered by status */
    index("idx_notices_company_status").on(t.companyId, t.status),
    /** Scheduled publishing: find past-due scheduled notices */
    index("idx_notices_scheduled").on(t.scheduledPublishAt, t.status),
  ],
);

// ── notice_building_targets ────────────────────────────────────────────────────

export const noticeBuildingTargetsTable = pgTable(
  "notice_building_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .references(() => noticesTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    buildingId: uuid("building_id")
      .references(() => buildingsTable.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique("uq_nbt_notice_building").on(t.noticeId, t.buildingId)],
);

// ── notice_unit_targets ────────────────────────────────────────────────────────

export const noticeUnitTargetsTable = pgTable(
  "notice_unit_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .references(() => noticesTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    unitId: uuid("unit_id")
      .references(() => unitsTable.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique("uq_nut_notice_unit").on(t.noticeId, t.unitId)],
);

// ── notice_versions ────────────────────────────────────────────────────────────

export const noticeVersionsTable = pgTable(
  "notice_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .references(() => noticesTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: noticeCategoryEnum("category").notNull(),
    audience: noticeAudienceEnum("audience").notNull(),
    /** JSON snapshot: { buildingIds: string[], unitIds: string[], targetingMode: string } */
    targetingSnapshot: jsonb("targeting_snapshot").notNull(),
    editedByUserId: uuid("edited_by_user_id").references(() => usersTable.id),
    editReason: text("edit_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("uq_nv_notice_version").on(t.noticeId, t.versionNumber),
    index("idx_notice_versions_notice").on(t.noticeId),
  ],
);

// ── notice_deliveries ──────────────────────────────────────────────────────────
// One row per unique (notice, user) pair — the user-facing read record.

export const noticeDeliveriesTable = pgTable(
  "notice_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .references(() => noticesTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    /** The primary role under which this user received this notice */
    recipientRole: text("recipient_role").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
    firstReadAt: timestamp("first_read_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    /** Version number last read by this user */
    lastReadVersion: integer("last_read_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("uq_nd_notice_user").on(t.noticeId, t.userId),
    /** User feed: all deliveries for a user */
    index("idx_nd_user_notice").on(t.userId, t.noticeId),
    /** Unread count: unread deliveries for a user */
    index("idx_nd_user_unread").on(t.userId, t.firstReadAt),
    /** Admin delivery list: all deliveries for a notice */
    index("idx_nd_notice_company").on(t.noticeId, t.companyId),
  ],
);

// ── notice_delivery_contexts ───────────────────────────────────────────────────
// One row per (delivery, unit/building) combination — the "why" audit trail.

export const noticeDeliveryContextsTable = pgTable(
  "notice_delivery_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .references(() => noticeDeliveriesTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    buildingId: uuid("building_id")
      .references(() => buildingsTable.id)
      .notNull(),
    unitId: uuid("unit_id").references(() => unitsTable.id),
    /** Role the user held in this unit at delivery time */
    relationshipRole: text("relationship_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_ndc_delivery").on(t.deliveryId)],
);

// ── building_timeline_events ───────────────────────────────────────────────────
// Minimal generic timeline for buildings. Notices write here on publish.
// The full timeline UI is a future module; this table is reusable.

export const buildingTimelineEventsTable = pgTable(
  "building_timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    buildingId: uuid("building_id")
      .references(() => buildingsTable.id)
      .notNull(),
    eventType: text("event_type").notNull(),
    noticeId: uuid("notice_id").references(() => noticesTable.id),
    title: text("title").notNull(),
    summary: text("summary"),
    metadata: jsonb("metadata"),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
    ),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    /** Prevent duplicate timeline entries when scheduled publishing runs twice */
    uniqueIndex("idx_bte_notice_dedup")
      .on(t.buildingId, t.eventType, t.noticeId)
      .where(sql`notice_id IS NOT NULL`),
    index("idx_bte_building_event_at").on(t.buildingId, t.eventAt),
  ],
);

// ── Insert schemas & types ─────────────────────────────────────────────────────

export const insertNoticeSchema = createInsertSchema(noticesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNotice = z.infer<typeof insertNoticeSchema>;
export type Notice = typeof noticesTable.$inferSelect;
export type NoticeVersion = typeof noticeVersionsTable.$inferSelect;
export type NoticeDelivery = typeof noticeDeliveriesTable.$inferSelect;
export type NoticeDeliveryContext =
  typeof noticeDeliveryContextsTable.$inferSelect;
export type BuildingTimelineEvent =
  typeof buildingTimelineEventsTable.$inferSelect;
