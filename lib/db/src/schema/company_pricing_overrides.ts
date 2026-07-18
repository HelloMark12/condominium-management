import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

/**
 * Per-company billing overrides.
 * Takes priority over the platform pricing_configs row.
 * Only fields that are not null override the platform config.
 */
export const companyPricingOverridesTable = pgTable(
  "company_pricing_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companiesTable.id)
      .notNull(),
    /** Override free unit threshold for this company. */
    customFreeUnitLimit: integer("custom_free_unit_limit"),
    customStandardMin: integer("custom_standard_min"),
    customStandardMax: integer("custom_standard_max"),
    customEnterpriseStart: integer("custom_enterprise_start"),
    /** Override rate per unit (cents) for the standard tier. */
    customRatePerUnitCents: integer("custom_rate_per_unit_cents"),
    /** Fixed monthly fee (cents) — overrides per-unit math entirely when set. */
    fixedMonthlyFeeCents: integer("fixed_monthly_fee_cents"),
    /** Custom enterprise rate (cents) — used when enterprise behavior = per_unit. */
    enterpriseCustomRateCents: integer("enterprise_custom_rate_cents"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    isActive: boolean("is_active").default(true).notNull(),
    reason: text("reason"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_cpo_company_active").on(t.companyId, t.isActive),
    index("idx_cpo_dates").on(t.startDate, t.endDate),
  ],
);

export const insertCompanyPricingOverrideSchema = createInsertSchema(
  companyPricingOverridesTable,
).omit({ id: true, createdAt: true });

export type InsertCompanyPricingOverride = z.infer<
  typeof insertCompanyPricingOverrideSchema
>;
export type CompanyPricingOverride =
  typeof companyPricingOverridesTable.$inferSelect;
