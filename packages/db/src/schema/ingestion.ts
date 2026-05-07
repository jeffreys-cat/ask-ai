import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { organization } from "./organization";

export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    error: text("error"),
    chunkCount: text("chunk_count").notNull().default("0"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index("ingestion_jobs_org_status_idx").on(table.organizationId, table.status),
  }),
);
