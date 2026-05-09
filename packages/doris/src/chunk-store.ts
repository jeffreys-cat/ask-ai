import type { DocumentChunk, RetrievedChunk } from "@selectdb/shared";
import { createLogger, serializeError } from "@selectdb/logger";
import type { DorisPool } from "./client";
import { assertSqlIdentifier, vectorLiteral } from "./client";

export interface ChunkStoreOptions {
  table?: string;
}

export function createChunkStore(pool: DorisPool, options: ChunkStoreOptions = {}) {
  const table = assertSqlIdentifier(options.table ?? process.env.DORIS_CHUNKS_TABLE ?? "document_chunks");
  const insertBatchSize = normalizeBatchSize(process.env.DORIS_INSERT_BATCH_SIZE, 100);
  const log = createLogger({ component: "doris.chunk-store", table });

  return {
    async upsertChunks(chunks: DocumentChunk[]) {
      if (chunks.length === 0) return;

      log.info("doris chunks upsert started", {
        organizationId: chunks[0]?.organizationId,
        documentId: chunks[0]?.documentId,
        chunkCount: chunks.length,
        insertBatchSize,
      });

      for (let start = 0; start < chunks.length; start += insertBatchSize) {
        const batch = chunks.slice(start, start + insertBatchSize);
        const values = batch.map((chunk) => [
          chunk.organizationId,
          chunk.documentId,
          chunk.chunkId,
          chunk.content,
          chunk.title ?? null,
          chunk.sourceUri ?? null,
          JSON.stringify(chunk.metadata),
          JSON.stringify(chunk.embedding),
        ]);

        await withDorisRetry(
          () =>
            pool.query(
              `INSERT INTO ${table}
                (organization_id, document_id, chunk_id, content, title, source_uri, metadata, embedding)
               VALUES ?`,
              [values],
            ),
          log,
          {
            operation: "upsertChunks",
            organizationId: batch[0]?.organizationId,
            documentId: batch[0]?.documentId,
            batchStart: start,
            batchCount: batch.length,
            chunkCount: chunks.length,
          },
        );
        log.debug("doris chunks upsert batch completed", {
          organizationId: batch[0]?.organizationId,
          documentId: batch[0]?.documentId,
          batchStart: start,
          batchCount: batch.length,
          chunkCount: chunks.length,
        });
      }

      log.info("doris chunks upsert completed", {
        organizationId: chunks[0]?.organizationId,
        documentId: chunks[0]?.documentId,
        chunkCount: chunks.length,
      });
    },

    async deleteDocumentChunks(organizationId: string, documentId: string) {
      log.info("doris document chunks delete started", { organizationId, documentId });
      await withDorisRetry(
        () => pool.execute(`DELETE FROM ${table} WHERE organization_id = ? AND document_id = ?`, [organizationId, documentId]),
        log,
        { operation: "deleteDocumentChunks", organizationId, documentId },
      );
      log.info("doris document chunks delete completed", { organizationId, documentId });
    },

    async searchChunks(input: {
      organizationId: string;
      queryEmbedding: number[];
      topK: number;
      documentIds?: string[];
    }): Promise<RetrievedChunk[]> {
      const topK = normalizeTopK(input.topK);
      const documentFilter =
        input.documentIds && input.documentIds.length > 0
          ? `AND document_id IN (${input.documentIds.map(() => "?").join(",")})`
          : "";
      const params = [input.organizationId, ...(input.documentIds ?? [])];

      const [rows] = await withDorisRetry(
        () =>
          pool.execute(
            `SELECT
                organization_id AS organizationId,
                document_id AS documentId,
                chunk_id AS chunkId,
                content,
                title,
                source_uri AS sourceUri,
                metadata,
                INNER_PRODUCT(embedding, ${vectorLiteral(input.queryEmbedding)}) AS score
             FROM ${table}
             WHERE organization_id = ?
             ${documentFilter}
             ORDER BY score DESC
             LIMIT ${topK}`,
            params,
          ),
        log,
        { operation: "searchChunks", organizationId: input.organizationId, topK, documentIdCount: input.documentIds?.length ?? 0 },
      );

      return (rows as Array<Record<string, unknown>>).map((row) => ({
        organizationId: String(row.organizationId),
        documentId: String(row.documentId),
        chunkId: String(row.chunkId),
        content: String(row.content),
        title: row.title ? String(row.title) : undefined,
        sourceUri: row.sourceUri ? String(row.sourceUri) : undefined,
        metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
        score: Number(row.score ?? 0),
      }));
    },
  };
}

function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return 8;
  return Math.min(Math.max(Math.trunc(topK), 1), 50);
}

function normalizeBatchSize(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 1000);
}

async function withDorisRetry<T>(operation: () => Promise<T>, log: ReturnType<typeof createLogger>, meta: Record<string, unknown>) {
  const maxRetries = normalizeRetryCount(process.env.DORIS_QUERY_RETRIES);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isRetryableDorisError(error);
      log.warn("doris query failed", {
        ...meta,
        attempt,
        maxRetries,
        retryable,
        error: serializeError(error),
      });
      if (!retryable || attempt >= maxRetries) throw error;
      await waitBeforeRetry(attempt);
    }
  }
  throw new Error("Doris query failed after retries");
}

function normalizeRetryCount(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.trunc(parsed), 0), 10);
}

function isRetryableDorisError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Connection lost|server closed|closed the connection|ECONNRESET|ETIMEDOUT|EPIPE|PROTOCOL_CONNECTION_LOST|socket/i.test(message);
}

function waitBeforeRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000)));
}
