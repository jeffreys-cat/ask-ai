import { and, eq } from "drizzle-orm";
import type { IngestionStatus, JsonObject } from "@selectdb/shared";
import type { DbClient } from "../client";
import { ingestionJobs } from "../schema";

export interface CreateIngestionInput {
  id: string;
  organizationId: string;
  documentId: string;
  metadata?: JsonObject;
}

export function createIngestionRepo(db: DbClient) {
  return {
    async create(input: CreateIngestionInput) {
      const [job] = await db.insert(ingestionJobs).values(input).returning();
      return job;
    },

    async updateStatus(input: {
      organizationId: string;
      ingestionId: string;
      status: IngestionStatus;
      error?: string | null;
      chunkCount?: number;
    }) {
      const [job] = await db
        .update(ingestionJobs)
        .set({
          status: input.status,
          error: input.error ?? null,
          chunkCount: input.chunkCount === undefined ? undefined : String(input.chunkCount),
          updatedAt: new Date(),
        })
        .where(and(eq(ingestionJobs.organizationId, input.organizationId), eq(ingestionJobs.id, input.ingestionId)))
        .returning();
      return job ?? null;
    },
  };
}
