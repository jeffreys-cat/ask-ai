import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
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
          completedAt: input.status === "completed" || input.status === "failed" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(ingestionJobs.organizationId, input.organizationId), eq(ingestionJobs.id, input.ingestionId)))
        .returning();
      return job ?? null;
    },

    async claimNext(input: { workerId: string; staleBefore: Date; maxAttempts: number }) {
      return db.transaction(async (tx) => {
        const [nextJob] = await tx
          .select({ id: ingestionJobs.id })
          .from(ingestionJobs)
          .where(
            or(
              and(eq(ingestionJobs.status, "queued"), lt(ingestionJobs.attempts, input.maxAttempts)),
              and(eq(ingestionJobs.status, "running"), or(isNull(ingestionJobs.lastHeartbeatAt), lt(ingestionJobs.lastHeartbeatAt, input.staleBefore))),
            ),
          )
          .orderBy(asc(ingestionJobs.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });

        if (!nextJob) return null;

        const [job] = await tx
          .update(ingestionJobs)
          .set({
            status: "running",
            lockedBy: input.workerId,
            lockedAt: new Date(),
            startedAt: sql`coalesce(${ingestionJobs.startedAt}, now())`,
            lastHeartbeatAt: new Date(),
            attempts: sql`${ingestionJobs.attempts} + 1`,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(ingestionJobs.id, nextJob.id))
          .returning();

        return job ?? null;
      });
    },

    async heartbeat(input: { ingestionId: string; workerId: string }) {
      const [job] = await db
        .update(ingestionJobs)
        .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
        .where(and(eq(ingestionJobs.id, input.ingestionId), eq(ingestionJobs.lockedBy, input.workerId), eq(ingestionJobs.status, "running")))
        .returning();
      return job ?? null;
    },

    async releaseForRetry(input: { ingestionId: string; workerId: string; error: string }) {
      const [job] = await db
        .update(ingestionJobs)
        .set({
          status: "queued",
          error: input.error,
          lockedBy: null,
          lockedAt: null,
          lastHeartbeatAt: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(ingestionJobs.id, input.ingestionId), eq(ingestionJobs.lockedBy, input.workerId)))
        .returning();
      return job ?? null;
    },

    async complete(input: { ingestionId: string; workerId: string; chunkCount: number }) {
      const [job] = await db
        .update(ingestionJobs)
        .set({
          status: "completed",
          error: null,
          chunkCount: String(input.chunkCount),
          lockedBy: null,
          lockedAt: null,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(ingestionJobs.id, input.ingestionId), eq(ingestionJobs.lockedBy, input.workerId)))
        .returning();
      return job ?? null;
    },

    async fail(input: { ingestionId: string; workerId: string; error: string }) {
      const [job] = await db
        .update(ingestionJobs)
        .set({
          status: "failed",
          error: input.error,
          lockedBy: null,
          lockedAt: null,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(ingestionJobs.id, input.ingestionId), eq(ingestionJobs.lockedBy, input.workerId)))
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
          attempts: ingestionJobs.attempts,
          lockedBy: ingestionJobs.lockedBy,
          lockedAt: ingestionJobs.lockedAt,
          startedAt: ingestionJobs.startedAt,
          completedAt: ingestionJobs.completedAt,
          lastHeartbeatAt: ingestionJobs.lastHeartbeatAt,
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

    async listByTask(organizationId: string, taskId: string) {
      return db
        .select()
        .from(ingestionJobs)
        .where(and(eq(ingestionJobs.organizationId, organizationId), sql`${ingestionJobs.metadata}->>'taskId' = ${taskId}`));
    },

    async listActiveByProject(organizationId: string, projectId: string) {
      return db
        .select({ status: ingestionJobs.status })
        .from(ingestionJobs)
        .innerJoin(documents, eq(ingestionJobs.documentId, documents.id))
        .where(
          and(
            eq(ingestionJobs.organizationId, organizationId),
            eq(documents.projectId, projectId),
            inArray(ingestionJobs.status, ["queued", "running"]),
          ),
        );
    },
  };
}
