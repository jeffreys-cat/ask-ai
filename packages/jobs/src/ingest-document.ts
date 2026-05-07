import type { DocumentChunk, JsonObject } from "@selectdb/shared";
import { BadRequestError } from "@selectdb/shared";
import type { DbClient } from "@selectdb/db";
import { createDocumentsRepo, createIngestionRepo } from "@selectdb/db";
import type { DorisPool } from "@selectdb/doris";
import { createChunkStore } from "@selectdb/doris";
import { chunkHtml, chunkMarkdown, embeddingProviderFromEnv, splitTextIntoChunks, type EmbeddingProvider } from "@selectdb/rag";

export interface IngestDocumentInput {
  organizationId: string;
  documentId: string;
  ingestionId: string;
  content: string;
  mimeType?: string | null;
  title?: string;
  metadata?: JsonObject;
  db: DbClient;
  doris: DorisPool;
  embeddings?: EmbeddingProvider;
}

export async function ingestDocument(input: IngestDocumentInput) {
  const documentsRepo = createDocumentsRepo(input.db);
  const ingestionRepo = createIngestionRepo(input.db);

  await ingestionRepo.updateStatus({
    organizationId: input.organizationId,
    ingestionId: input.ingestionId,
    status: "running",
  });
  await documentsRepo.updateStatus(input.organizationId, input.documentId, "ingesting");

  try {
    const chunks = chunkByMime(input.content, {
      documentId: input.documentId,
      mimeType: input.mimeType,
      metadata: input.metadata,
    });
    const vectors = await (input.embeddings ?? embeddingProviderFromEnv()).embed(chunks.map((chunk) => chunk.content));
    const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
      organizationId: input.organizationId,
      documentId: input.documentId,
      chunkId: chunk.chunkId,
      content: chunk.content,
      title: input.title,
      metadata: chunk.metadata,
      embedding: vectors[index] ?? [],
    }));

    const chunkStore = createChunkStore(input.doris);
    await chunkStore.deleteDocumentChunks(input.organizationId, input.documentId);
    await chunkStore.upsertChunks(documentChunks);
    await documentsRepo.updateStatus(input.organizationId, input.documentId, "ready");
    await ingestionRepo.updateStatus({
      organizationId: input.organizationId,
      ingestionId: input.ingestionId,
      status: "completed",
      chunkCount: documentChunks.length,
    });

    return { chunkCount: documentChunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    await documentsRepo.updateStatus(input.organizationId, input.documentId, "failed");
    await ingestionRepo.updateStatus({
      organizationId: input.organizationId,
      ingestionId: input.ingestionId,
      status: "failed",
      error: message,
    });
    throw error;
  }
}

function chunkByMime(input: string, options: { documentId: string; mimeType?: string | null; metadata?: JsonObject }) {
  const mime = options.mimeType ?? "text/plain";
  if (mime.includes("markdown") || mime.includes("md")) {
    return chunkMarkdown(input, { documentId: options.documentId, metadata: options.metadata });
  }
  if (mime.includes("html")) {
    return chunkHtml(input, { documentId: options.documentId, metadata: options.metadata });
  }
  if (mime.includes("text") || mime === "application/octet-stream") {
    return splitTextIntoChunks(input, {
      documentId: options.documentId,
      metadata: { ...(options.metadata ?? {}), parser: "text" },
    });
  }
  if (mime.includes("pdf")) {
    throw new BadRequestError("PDF parsing is reserved for a later milestone");
  }
  throw new BadRequestError(`Unsupported document mime type: ${mime}`);
}
