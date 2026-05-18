import type { Citation, JsonObject } from "@selectdb/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../client";
import { askMessages, askSessions } from "../schema";

export function createAskRepo(db: DbClient) {
  return {
    async createSession(input: {
      id: string;
      organizationId: string;
      userId: string;
      question: string;
      metadata?: JsonObject;
    }) {
      const [session] = await db.insert(askSessions).values(input).returning();
      await db.insert(askMessages).values({
        id: crypto.randomUUID(),
        sessionId: input.id,
        role: "user",
        content: input.question,
      });
      return session;
    },

    async completeSession(input: { sessionId: string; answer: string; citations: Citation[] }) {
      await db.insert(askMessages).values({
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        role: "assistant",
        content: input.answer,
        metadata: { citations: input.citations as unknown as Record<string, unknown>[] },
      });
      const [session] = await db
        .update(askSessions)
        .set({ answer: input.answer, citations: input.citations as unknown as Record<string, unknown>[], updatedAt: new Date() })
        .where(eq(askSessions.id, input.sessionId))
        .returning();
      return session ?? null;
    },

    async addUserMessage(input: { sessionId: string; question: string }) {
      await db.insert(askMessages).values({
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        role: "user",
        content: input.question,
      });
      const [session] = await db.update(askSessions).set({ updatedAt: new Date() }).where(eq(askSessions.id, input.sessionId)).returning();
      return session ?? null;
    },

    async listSessions(input: { organizationId: string; projectId?: string; limit?: number }) {
      const filters = [eq(askSessions.organizationId, input.organizationId)];
      if (input.projectId) {
        filters.push(sql`${askSessions.metadata}->>'projectId' = ${input.projectId}`);
      }

      return db
        .select()
        .from(askSessions)
        .where(and(...filters))
        .orderBy(desc(askSessions.updatedAt))
        .limit(input.limit ?? 50);
    },

    async findSession(input: { organizationId: string; sessionId: string }) {
      const [session] = await db
        .select()
        .from(askSessions)
        .where(and(eq(askSessions.organizationId, input.organizationId), eq(askSessions.id, input.sessionId)))
        .limit(1);
      return session ?? null;
    },

    async listMessages(input: { sessionId: string }) {
      return db.select().from(askMessages).where(eq(askMessages.sessionId, input.sessionId)).orderBy(asc(askMessages.createdAt));
    },
  };
}
