import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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

export const unitMembershipsTable = pgTable("unit_memberships", {
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
});

export const insertUnitMembershipSchema = createInsertSchema(
  unitMembershipsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertUnitMembership = z.infer<typeof insertUnitMembershipSchema>;
export type UnitMembership = typeof unitMembershipsTable.$inferSelect;
