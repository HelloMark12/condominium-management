import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const pricingConfigStatusEnum = pgEnum("pricing_config_status", [
  "draft",
  "scheduled",
  "active",
  "retired",
]);

export const enterprisePricingBehaviorEnum = pgEnum(
  "enterprise_pricing_behavior",
  ["custom", "per_unit", "fixed"],
);

/**
 * Versioned, auditable pricing configuration.
 * Replaces the old single-row pricing_config table.
 * The active config for a billing month is the row with:
 *   status = 'active'
 *   effectiveFrom <= billingMonth
 *   effectiveTo IS NULL OR effectiveTo >= billingMonth
 * ordered by effectiveFrom DESC (newest wins).
 */
export const pricingConfigsTable = pgTable(
  "pricing_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Number of active apartments below which no charge applies (inclusive). */
    freeUnitLimit: integer("free_unit_limit").notNull(),
    /** First paid tier start (typically freeUnitLimit + 1). */
    standardMin: integer("standard_min").notNull(),
    /** Last apartment count still on standard (inclusive). */
    standardMax: integer("standard_max").notNull(),
    /** First apartment count on enterprise tier. */
    enterpriseStart: integer("enterprise_start").notNull(),
    /** Cents per apartment per month for the standard tier. */
    ratePerUnitCents: integer("rate_per_unit_cents").notNull(),
    enterprisePricingBehavior: enterprisePricingBehaviorEnum(
      "enterprise_pricing_behavior",
    )
      .default("custom")
      .notNull(),
    /** Only meaningful when enterprisePricingBehavior = 'fixed'. */
    enterpriseFixedRateCents: integer("enterprise_fixed_rate_cents"),
    /** Only meaningful when enterprisePricingBehavior = 'per_unit'. */
    enterprisePerUnitRateCents: integer("enterprise_per_unit_rate_cents"),
    currency: text("currency").default("EUR").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: pricingConfigStatusEnum("status").default("draft").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_pricing_configs_effective").on(t.effectiveFrom, t.status),
  ],
);

export const insertPricingConfigSchema = createInsertSchema(
  pricingConfigsTable,
).omit({ id: true, createdAt: true });

export type InsertPricingConfig = z.infer<typeof insertPricingConfigSchema>;
export type PricingConfig = typeof pricingConfigsTable.$inferSelect;
