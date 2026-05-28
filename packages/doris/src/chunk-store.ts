import type { DocumentChunk, RetrievedChunk } from "@selectdb/shared";
import { createLogger, serializeError } from "@selectdb/logger";
import type { DorisPool } from "./client";
import { assertSqlIdentifier, vectorLiteral } from "./client";

export interface ChunkStoreOptions {
  table?: string;
}

export interface SearchChunksInput {
  organizationId: string;
  query: string;
  queryEmbedding: number[];
  topK: number;
  documentIds?: string[];
}

type RetrievalBranch = "vector" | "keyword";
type SearchCandidate = RetrievedChunk & { branchScore: number };

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

    async searchChunks(input: SearchChunksInput): Promise<RetrievedChunk[]> {
      const topK = normalizeTopK(input.topK);
      const candidateK = normalizeCandidateK(topK);
      const documentFilter =
        input.documentIds && input.documentIds.length > 0
          ? `AND document_id IN (${input.documentIds.map(() => "?").join(",")})`
          : "";
      const params = [input.organizationId, ...(input.documentIds ?? [])];

      const [vectorRows] = await withDorisRetry(
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
                INNER_PRODUCT(embedding, ${vectorLiteral(input.queryEmbedding)}) AS vectorScore
             FROM ${table}
             WHERE organization_id = ?
             ${documentFilter}
             ORDER BY vectorScore DESC
             LIMIT ${candidateK}`,
            params,
          ),
        log,
        {
          operation: "searchChunks.vector",
          organizationId: input.organizationId,
          topK,
          candidateK,
          documentIdCount: input.documentIds?.length ?? 0,
        },
      );

      const vectorCandidates = mapSearchRows(vectorRows as Array<Record<string, unknown>>, "vectorScore");
      const keywordQuery = input.query.trim();
      if (!keywordQuery) return fuseRetrievedChunks({ vector: vectorCandidates, keyword: [], topK });

      try {
        const [keywordRows] = await withDorisRetry(
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
                  score() AS keywordScore
               FROM ${table}
               WHERE organization_id = ?
               ${documentFilter}
               AND content MATCH_ANY ?
               ORDER BY keywordScore DESC
               LIMIT ${candidateK}`,
              [...params, keywordQuery],
            ),
          log,
          {
            operation: "searchChunks.keyword",
            organizationId: input.organizationId,
            topK,
            candidateK,
            documentIdCount: input.documentIds?.length ?? 0,
          },
        );
        const keywordCandidates = mapSearchRows(keywordRows as Array<Record<string, unknown>>, "keywordScore");
        return fuseRetrievedChunks({ vector: vectorCandidates, keyword: keywordCandidates, topK });
      } catch (error) {
        log.warn("doris keyword search failed; falling back to vector results", {
          operation: "searchChunks.keyword",
          organizationId: input.organizationId,
          topK,
          candidateK,
          documentIdCount: input.documentIds?.length ?? 0,
          error: serializeError(error),
        });
        return fuseRetrievedChunks({ vector: vectorCandidates, keyword: [], topK });
      }
    },
  };
}

function mapSearchRows(rows: Array<Record<string, unknown>>, scoreField: "vectorScore" | "keywordScore"): SearchCandidate[] {
  return rows.map((row) => {
    const branchScore = Number(row[scoreField] ?? 0);
    return {
      organizationId: String(row.organizationId),
      documentId: String(row.documentId),
      chunkId: String(row.chunkId),
      content: String(row.content),
      title: row.title ? String(row.title) : undefined,
      sourceUri: row.sourceUri ? String(row.sourceUri) : undefined,
      metadata: parseMetadata(row.metadata),
      score: branchScore,
      branchScore,
    };
  });
}

function parseMetadata(metadata: unknown) {
  if (typeof metadata === "string") return JSON.parse(metadata) as Record<string, unknown>;
  if (metadata && typeof metadata === "object") return metadata as Record<string, unknown>;
  return {};
}

export function fuseRetrievedChunks(input: {
  vector: SearchCandidate[];
  keyword: SearchCandidate[];
  topK: number;
  rrfK?: number;
}): RetrievedChunk[] {
  const topK = normalizeTopK(input.topK);
  const rrfK = input.rrfK ?? 60;
  const merged = new Map<
    string,
    RetrievedChunk & {
      retrieval: NonNullable<RetrievedChunk["retrieval"]>;
      bestRank: number;
    }
  >();

  addBranch(merged, input.vector, "vector", rrfK);
  addBranch(merged, input.keyword, "keyword", rrfK);

  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.documentId.localeCompare(b.documentId) || a.chunkId.localeCompare(b.chunkId))
    .slice(0, topK)
    .map(({ bestRank: _bestRank, ...chunk }) => chunk);
}

function addBranch(
  merged: Map<string, RetrievedChunk & { retrieval: NonNullable<RetrievedChunk["retrieval"]>; bestRank: number }>,
  chunks: SearchCandidate[],
  branch: RetrievalBranch,
  rrfK: number,
) {
  chunks.forEach((chunk, index) => {
    const rank = index + 1;
    const key = `${chunk.documentId}:${chunk.chunkId}`;
    const existing =
      merged.get(key) ??
      ({
        ...chunk,
        score: 0,
        retrieval: {
          mode: "hybrid",
          matchedBy: [],
        },
        bestRank: rank,
      } satisfies RetrievedChunk & { retrieval: NonNullable<RetrievedChunk["retrieval"]>; bestRank: number });

    existing.score += 1 / (rrfK + rank);
    existing.bestRank = Math.min(existing.bestRank, rank);
    if (!existing.retrieval.matchedBy.includes(branch)) existing.retrieval.matchedBy.push(branch);
    if (branch === "vector") {
      existing.retrieval.vectorRank = rank;
      existing.retrieval.vectorScore = chunk.branchScore;
    } else {
      existing.retrieval.keywordRank = rank;
      existing.retrieval.keywordScore = chunk.branchScore;
    }
    merged.set(key, existing);
  });
}

function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return 8;
  return Math.min(Math.max(Math.trunc(topK), 1), 50);
}

export function normalizeCandidateK(topK: number) {
  return Math.min(Math.max(normalizeTopK(topK) * 4, 20), 50);
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
