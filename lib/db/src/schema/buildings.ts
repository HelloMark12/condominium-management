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

export const buildingStatusEnum = pgEnum("building_status", [
  "active",
  "inactive",
]);

export const buildingsTable = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companiesTable.id)
    .notNull(),
  name: text("name").notNull(),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  locality: text("locality").notNull(),
  postcode: text("postcode"),
  country: text("country").default("MT").notNull(),
  status: buildingStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertBuildingSchema = createInsertSchema(buildingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBuilding = z.infer<typeof insertBuildingSchema>;
export type Building = typeof buildingsTable.$inferSelect;
