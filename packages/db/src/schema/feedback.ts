import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { askSessions } from "./ask";
import { organization } from "./organization";

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  askSessionId: text("ask_session_id").notNull().references(() => askSessions.id, { onDelete: "cascade" }),
  rating: text("rating").notNull(),
  comment: text("comment"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
