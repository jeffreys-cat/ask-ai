import type { DocumentChunk, JsonObject } from "@selectdb/shared";
import { BadRequestError } from "@selectdb/shared";
import type { DbClient } from "@selectdb/db";
import { createDocumentsRepo, createIngestionRepo } from "@selectdb/db";
import type { DorisPool } from "@selectdb/doris";
import { createChunkStore } from "@selectdb/doris";
import { createLogger, serializeError } from "@selectdb/logger";
import { chunkHtml, chunkMarkdown, embeddingProviderFromEnv, splitTextIntoChunks, type EmbeddingProvider } from "@selectdb/rag";

export interface IngestDocumentInput {
  organizationId: string;
  documentId: string;
  ingestionId: string;
  content: string;
  mimeType?: string | null;
  title?: string;
  sourceUri?: string;
  metadata?: JsonObject;
  db: DbClient;
  doris: DorisPool;
  embeddings?: EmbeddingProvider;
}

export async function ingestDocument(input: IngestDocumentInput) {
  const log = createLogger({
    component: "jobs.ingest-document",
    organizationId: input.organizationId,
    documentId: input.documentId,
    ingestionId: input.ingestionId,
    sourceUri: input.sourceUri,
  });
  const documentsRepo = createDocumentsRepo(input.db);
  const ingestionRepo = createIngestionRepo(input.db);

  await ingestionRepo.updateStatus({
    organizationId: input.organizationId,
    ingestionId: input.ingestionId,
    status: "running",
  });
  await documentsRepo.updateStatus(input.organizationId, input.documentId, "ingesting");
  log.info("document ingestion started", { mimeType: input.mimeType, title: input.title, contentLength: input.content.length });

  try {
    const chunks = chunkByMime(input.content, {
      documentId: input.documentId,
      mimeType: input.mimeType,
      metadata: input.metadata,
    });

    const chunkStore = createChunkStore(input.doris);
    await chunkStore.deleteDocumentChunks(input.organizationId, input.documentId);

    if (chunks.length === 0) {
      log.warn("document ingestion produced no chunks", { mimeType: input.mimeType, title: input.title });
      await documentsRepo.updateStatus(input.organizationId, input.documentId, "ready");
      await ingestionRepo.updateStatus({
        organizationId: input.organizationId,
        ingestionId: input.ingestionId,
        status: "completed",
        chunkCount: 0,
      });
      return { chunkCount: 0 };
    }

    log.info("document chunks created", {
      chunkCount: chunks.length,
      totalChunkChars: chunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
      maxChunkChars: Math.max(...chunks.map((chunk) => chunk.content.length)),
    });
    const vectors = await (input.embeddings ?? embeddingProviderFromEnv()).embed(chunks.map((chunk) => chunk.content));
    log.info("document embeddings created", { chunkCount: chunks.length, vectorCount: vectors.length });
    const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
      organizationId: input.organizationId,
      documentId: input.documentId,
      chunkId: chunk.chunkId,
      content: chunk.content,
      title: input.title,
      sourceUri: input.sourceUri,
      metadata: normalizeChunkMetadata(chunk.metadata),
      embedding: vectors[index] ?? [],
    }));

    await chunkStore.upsertChunks(documentChunks);
    log.info("document chunks stored", { chunkCount: documentChunks.length });
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
    log.error("document ingestion failed", { error: serializeError(error) });
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

function normalizeChunkMetadata(metadata: JsonObject): JsonObject {
  const frontmatter = objectValue(metadata.frontmatter);
  const normalized: JsonObject = { ...metadata };

  assignCanonicalString(normalized, "version", firstString(metadata.version, frontmatter.version));
  assignCanonicalString(normalized, "language", firstString(metadata.language, metadata.lang, frontmatter.language, frontmatter.lang));
  assignCanonicalString(
    normalized,
    "productLine",
    firstString(metadata.productLine, metadata.product_line, metadata.product, frontmatter.productLine, frontmatter.product_line, frontmatter.product),
  );
  assignCanonicalString(
    normalized,
    "publishedAt",
    normalizeDateString(firstString(metadata.publishedAt, metadata.published_at, metadata.lastmod, frontmatter.publishedAt, frontmatter.published_at, frontmatter.lastmod)),
  );
  assignCanonicalString(normalized, "visibility", firstString(metadata.visibility, frontmatter.visibility));
  assignCanonicalStringArray(normalized, "allowedUserIds", firstStringArray(metadata.allowedUserIds, metadata.allowed_user_ids, frontmatter.allowedUserIds, frontmatter.allowed_user_ids));
  assignCanonicalStringArray(
    normalized,
    "allowedApiKeyIds",
    firstStringArray(metadata.allowedApiKeyIds, metadata.allowed_api_key_ids, frontmatter.allowedApiKeyIds, frontmatter.allowed_api_key_ids),
  );

  return normalized;
}

function assignCanonicalString(metadata: JsonObject, key: string, value: string | undefined) {
  if (value) metadata[key] = value;
}

function assignCanonicalStringArray(metadata: JsonObject, key: string, value: string[] | undefined) {
  if (value && value.length > 0) metadata[key] = value;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstStringArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const items = value.map((item) => firstString(item)).filter((item): item is string => Boolean(item));
      if (items.length > 0) return items;
    }
    const scalar = firstString(value);
    if (scalar) return scalar.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

function normalizeDateString(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
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
