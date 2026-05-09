import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ProjectStatus } from "@selectdb/shared";
import { organization } from "./organization";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<ProjectStatus>().notNull().default("created"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index("projects_org_status_idx").on(table.organizationId, table.status),
  }),
);
