import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const platformAdminLevelEnum = pgEnum("platform_admin_level", [
  "owner",
  "admin",
]);

/**
 * Server-side allowlist of platform super-admins.
 * This is NOT a frontend flag — it is enforced exclusively in the API.
 * Each userId must exist in usersTable (Clerk user synced).
 */
export const platformAdminsTable = pgTable("platform_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => usersTable.id)
    .unique()
    .notNull(),
  level: platformAdminLevelEnum("level").default("admin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdBy: uuid("created_by").references(() => usersTable.id),
  notes: text("notes"),
});

export const insertPlatformAdminSchema = createInsertSchema(
  platformAdminsTable,
).omit({ id: true, createdAt: true });

export type InsertPlatformAdmin = z.infer<typeof insertPlatformAdminSchema>;
export type PlatformAdmin = typeof platformAdminsTable.$inferSelect;
