import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { buildingsTable } from "./buildings";

export const unitTypeEnum = pgEnum("unit_type", [
  "apartment",
  "garage",
  "commercial",
  "other",
]);

export const unitStatusEnum = pgEnum("unit_status", ["active", "archived"]);

export const unitsTable = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companiesTable.id)
    .notNull(),
  buildingId: uuid("building_id")
    .references(() => buildingsTable.id)
    .notNull(),
  unitNumber: text("unit_number").notNull(),
  unitType: unitTypeEnum("unit_type").default("apartment").notNull(),
  floor: integer("floor"),
  status: unitStatusEnum("status").default("active").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertUnitSchema = createInsertSchema(unitsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof unitsTable.$inferSelect;
