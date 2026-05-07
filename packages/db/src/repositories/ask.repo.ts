import type { Citation, JsonObject } from "@selectdb/shared";
import { eq } from "drizzle-orm";
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
  };
}
