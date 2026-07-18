import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable, subscriptionTierEnum } from "./companies";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "open",
  "finalised",
  "void",
]);

export const monthlyUsageRecordsTable = pgTable(
  "monthly_usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    billingMonth: date("billing_month").notNull(),
    timezone: text("timezone").default("Europe/Malta").notNull(),
    activeUnitCount: integer("active_unit_count").default(0).notNull(),
    peakActiveUnitCount: integer("peak_active_unit_count").default(0).notNull(),
    subscriptionTier: subscriptionTierEnum("subscription_tier")
      .default("free")
      .notNull(),
    ratePerUnitCents: integer("rate_per_unit_cents").default(0).notNull(),
    estimatedAmountCents: integer("estimated_amount_cents").default(0).notNull(),
    finalAmountCents: integer("final_amount_cents"),
    invoiceStatus: invoiceStatusEnum("invoice_status").default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.companyId, t.billingMonth)],
);

export const insertMonthlyUsageRecordSchema = createInsertSchema(
  monthlyUsageRecordsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertMonthlyUsageRecord = z.infer<
  typeof insertMonthlyUsageRecordSchema
>;
export type MonthlyUsageRecord = typeof monthlyUsageRecordsTable.$inferSelect;
