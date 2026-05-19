import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { projects } from "./projects";

export const projectApiKeys = pgTable(
  "project_api_keys",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyLast4: text("key_last4").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    keyHashIdx: uniqueIndex("project_api_keys_key_hash_idx").on(table.keyHash),
    projectCreatedIdx: index("project_api_keys_project_created_idx").on(table.organizationId, table.projectId, table.createdAt),
  }),
);
