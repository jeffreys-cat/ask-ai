import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./organization";

export const askSessions = pgTable(
  "ask_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    citations: jsonb("citations").$type<Record<string, unknown>[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index("ask_sessions_org_created_idx").on(table.organizationId, table.createdAt),
  }),
);

export const askMessages = pgTable("ask_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => askSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
