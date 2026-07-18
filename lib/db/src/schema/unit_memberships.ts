import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import { unitsTable } from "./units";

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "tenant",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "pending",
  "active",
  "revoked",
]);

export const unitMembershipsTable = pgTable(
  "unit_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .references(() => unitsTable.id)
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    userId: uuid("user_id").references(() => usersTable.id),
    invitedByUserId: uuid("invited_by_user_id").references(() => usersTable.id),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").default("pending").notNull(),
    invitedName: text("invited_name").notNull(),
    invitedEmail: text("invited_email").notNull(),
    invitationToken: text("invitation_token").unique(),
    invitationExpiresAt: timestamp("invitation_expires_at", {
      withTimezone: true,
    }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    /**
     * H1: Only one active/pending owner per apartment.
     * Partial unique index enforced at DB level.
     */
    uniqueIndex("um_one_owner_per_unit")
      .on(t.unitId)
      .where(sql`role = 'owner' AND status IN ('pending', 'active')`),
    /**
     * H2: Only one active/pending tenant per apartment.
     */
    uniqueIndex("um_one_tenant_per_unit")
      .on(t.unitId)
      .where(sql`role = 'tenant' AND status IN ('pending', 'active')`),
    /** M2: Efficient lookup by user + role + status (portal access queries). */
    index("idx_um_user_role_status").on(t.userId, t.role, t.status),
    /** M2: Efficient lookup by company + status (admin dashboard queries). */
    index("idx_um_company_status").on(t.companyId, t.status),
  ],
);

export const insertUnitMembershipSchema = createInsertSchema(
  unitMembershipsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertUnitMembership = z.infer<typeof insertUnitMembershipSchema>;
export type UnitMembership = typeof unitMembershipsTable.$inferSelect;
