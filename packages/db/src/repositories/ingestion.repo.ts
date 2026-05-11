import { and, desc, eq } from "drizzle-orm";
import type { IngestionStatus, JsonObject } from "@selectdb/shared";
import type { DbClient } from "../client";
import { documents, ingestionJobs } from "../schema";

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

    async listByProject(organizationId: string, projectId: string) {
      return db
        .select({
          id: ingestionJobs.id,
          organizationId: ingestionJobs.organizationId,
          documentId: ingestionJobs.documentId,
          status: ingestionJobs.status,
          error: ingestionJobs.error,
          chunkCount: ingestionJobs.chunkCount,
          metadata: ingestionJobs.metadata,
          createdAt: ingestionJobs.createdAt,
          updatedAt: ingestionJobs.updatedAt,
          documentTitle: documents.title,
          documentMetadata: documents.metadata,
        })
        .from(ingestionJobs)
        .innerJoin(documents, eq(ingestionJobs.documentId, documents.id))
        .where(and(eq(ingestionJobs.organizationId, organizationId), eq(documents.projectId, projectId)))
        .orderBy(desc(ingestionJobs.createdAt));
    },
  };
}
