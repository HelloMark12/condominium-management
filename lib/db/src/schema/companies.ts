import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "standard",
  "enterprise",
]);

export const companyRoleEnum = pgEnum("company_role", ["administrator"]);

export const companiesTable = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  subscriptionTier: subscriptionTierEnum("subscription_tier")
    .default("free")
    .notNull(),
  enterpriseFlagged: boolean("enterprise_flagged").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const companyMembershipsTable = pgTable(
  "company_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    role: companyRoleEnum("role").default("administrator").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.companyId, t.userId)],
);

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyMembershipSchema = createInsertSchema(
  companyMembershipsTable,
).omit({ id: true, createdAt: true });

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
export type CompanyMembership = typeof companyMembershipsTable.$inferSelect;
