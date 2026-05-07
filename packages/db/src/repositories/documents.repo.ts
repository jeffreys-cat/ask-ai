import { and, eq } from "drizzle-orm";
import type { DocumentStatus, JsonObject, SourceType } from "@selectdb/shared";
import type { DbClient } from "../client";
import { documents } from "../schema";

export interface CreateDocumentInput {
  id: string;
  organizationId: string;
  title: string;
  sourceType: SourceType;
  mimeType?: string | null;
  metadata?: JsonObject;
  createdBy: string;
}

export function createDocumentsRepo(db: DbClient) {
  return {
    async create(input: CreateDocumentInput) {
      const [document] = await db.insert(documents).values(input).returning();
      return document;
    },

    async findById(organizationId: string, documentId: string) {
      const [document] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
        .limit(1);
      return document ?? null;
    },

    async updateStatus(organizationId: string, documentId: string, status: DocumentStatus) {
      const [document] = await db
        .update(documents)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
        .returning();
      return document ?? null;
    },
  };
}
