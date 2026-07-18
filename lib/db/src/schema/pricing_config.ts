import {
  date,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subscriptionTierEnum } from "./companies";

export const pricingConfigTable = pgTable("pricing_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tier: subscriptionTierEnum("tier").notNull(),
  ratePerUnitCents: integer("rate_per_unit_cents").notNull(),
  minUnits: integer("min_units").notNull(),
  maxUnits: integer("max_units"), // null means no upper limit (enterprise)
  effectiveFrom: date("effective_from").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertPricingConfigSchema = createInsertSchema(
  pricingConfigTable,
).omit({ id: true, createdAt: true });

export type InsertPricingConfig = z.infer<typeof insertPricingConfigSchema>;
export type PricingConfig = typeof pricingConfigTable.$inferSelect;
