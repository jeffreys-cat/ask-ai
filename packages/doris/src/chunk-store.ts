import type { AccessContext, DocumentChunk, MetadataFilters, RetrievalTraceCandidate, RetrievalTraceEvent, RetrievedChunk } from "@selectdb/shared";
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
  candidateK?: number;
  documentIds?: string[];
  filters?: MetadataFilters;
  accessContext?: AccessContext;
  onRetrievalTrace?: (event: RetrievalTraceEvent) => void;
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
      const hasExplicitCandidateK = input.candidateK !== undefined;
      const candidateK = hasExplicitCandidateK ? normalizeExplicitCandidateK(input.candidateK, topK) : normalizeCandidateK(topK);
      const resultK = hasExplicitCandidateK ? candidateK : topK;
      const predicate = buildSearchPredicate(input);

      const vectorStartedAt = performance.now();
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
             WHERE ${predicate.clause}
             ORDER BY vectorScore DESC
             LIMIT ${candidateK}`,
            predicate.params,
          ),
        log,
        {
          operation: "searchChunks.vector",
          organizationId: input.organizationId,
          topK,
          candidateK,
          documentIdCount: input.documentIds?.length ?? 0,
          hasFilters: hasMetadataFilters(input.filters),
        },
      );

      const vectorCandidates = mapSearchRows(vectorRows as Array<Record<string, unknown>>, "vectorScore");
      emitRetrievalTrace(input.onRetrievalTrace, {
        type: "vector_candidates",
        topK,
        candidateK,
        returnedCount: vectorCandidates.length,
        latencyMs: elapsed(vectorStartedAt),
        candidates: summarizeBranchCandidates(vectorCandidates),
      });
      const keywordQuery = input.query.trim();
      if (!keywordQuery) {
        const fused = fuseRetrievedChunks({ vector: vectorCandidates, keyword: [], topK: resultK });
        emitRrfTrace(input.onRetrievalTrace, { vectorCandidates, keywordCandidates: [], fused, topK: resultK });
        return fused;
      }

      try {
        const keywordStartedAt = performance.now();
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
               WHERE ${predicate.clause}
               AND content MATCH_ANY ?
               ORDER BY keywordScore DESC
               LIMIT ${candidateK}`,
              [...predicate.params, keywordQuery],
            ),
          log,
          {
            operation: "searchChunks.keyword",
            organizationId: input.organizationId,
            topK,
            candidateK,
            documentIdCount: input.documentIds?.length ?? 0,
            hasFilters: hasMetadataFilters(input.filters),
          },
        );
        const keywordCandidates = mapSearchRows(keywordRows as Array<Record<string, unknown>>, "keywordScore");
        emitRetrievalTrace(input.onRetrievalTrace, {
          type: "keyword_candidates",
          query: keywordQuery,
          topK,
          candidateK,
          returnedCount: keywordCandidates.length,
          latencyMs: elapsed(keywordStartedAt),
          candidates: summarizeBranchCandidates(keywordCandidates),
        });
        const fused = fuseRetrievedChunks({ vector: vectorCandidates, keyword: keywordCandidates, topK: resultK });
        emitRrfTrace(input.onRetrievalTrace, { vectorCandidates, keywordCandidates, fused, topK: resultK });
        return fused;
      } catch (error) {
        log.warn("doris keyword search failed; falling back to vector results", {
          operation: "searchChunks.keyword",
          organizationId: input.organizationId,
          topK,
          candidateK,
          documentIdCount: input.documentIds?.length ?? 0,
          hasFilters: hasMetadataFilters(input.filters),
          error: serializeError(error),
        });
        emitRetrievalTrace(input.onRetrievalTrace, {
          type: "keyword_candidates",
          query: keywordQuery,
          topK,
          candidateK,
          returnedCount: 0,
          latencyMs: 0,
          fallback: true,
          error: error instanceof Error ? error.message : String(error),
          candidates: [],
        });
        const fused = fuseRetrievedChunks({ vector: vectorCandidates, keyword: [], topK: resultK });
        emitRrfTrace(input.onRetrievalTrace, { vectorCandidates, keywordCandidates: [], fused, topK: resultK });
        return fused;
      }
    },
  };
}

function buildSearchPredicate(input: SearchChunksInput) {
  const clauses: string[] = ["organization_id = ?"];
  const params: string[] = [input.organizationId];

  if (input.documentIds && input.documentIds.length > 0) {
    clauses.push(`document_id IN (${input.documentIds.map(() => "?").join(",")})`);
    params.push(...input.documentIds);
  }

  addMetadataStringFilter(clauses, params, "version", input.filters?.version);
  addMetadataStringFilter(clauses, params, "language", input.filters?.language);
  addMetadataStringFilter(clauses, params, "productLine", input.filters?.productLine);

  const publishedAt = input.filters?.publishedAt;
  if (publishedAt?.from) {
    clauses.push(`${metadataString("publishedAt")} >= ?`);
    params.push(publishedAt.from);
  }
  if (publishedAt?.to) {
    clauses.push(`${metadataString("publishedAt")} <= ?`);
    params.push(publishedAt.to);
  }

  addAccessFilter(clauses, params, input.accessContext);

  return {
    clause: clauses.join("\n               AND "),
    params,
  };
}

function addMetadataStringFilter(clauses: string[], params: string[], field: "version" | "language" | "productLine", value?: string | string[]) {
  const values = normalizeFilterValues(value);
  if (values.length === 0) return;

  if (values.length === 1) {
    clauses.push(`${metadataString(field)} = ?`);
    params.push(values[0]!);
    return;
  }

  clauses.push(`${metadataString(field)} IN (${values.map(() => "?").join(",")})`);
  params.push(...values);
}

function addAccessFilter(clauses: string[], params: string[], accessContext?: AccessContext) {
  const visibility = metadataString("visibility");
  const allowClauses: string[] = [];

  if (accessContext?.userId) {
    allowClauses.push("JSON_CONTAINS(metadata, ?, '$.allowedUserIds')");
    params.push(JSON.stringify(accessContext.userId));
  }
  if (accessContext?.apiKeyId) {
    allowClauses.push("JSON_CONTAINS(metadata, ?, '$.allowedApiKeyIds')");
    params.push(JSON.stringify(accessContext.apiKeyId));
  }

  clauses.push(
    `(${visibility} IS NULL OR ${visibility} = '' OR ${visibility} = 'public' OR (${visibility} = 'restricted' AND (${allowClauses.join(" OR ") || "FALSE"})))`,
  );
}

function metadataString(field: "version" | "language" | "productLine" | "publishedAt" | "visibility") {
  return `JSON_EXTRACT_STRING(metadata, '$.${field}')`;
}

function normalizeFilterValues(value?: string | string[]) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => item.trim()).filter(Boolean);
}

function hasMetadataFilters(filters?: MetadataFilters) {
  return Boolean(
    normalizeFilterValues(filters?.version).length ||
      normalizeFilterValues(filters?.language).length ||
      normalizeFilterValues(filters?.productLine).length ||
      filters?.publishedAt?.from ||
      filters?.publishedAt?.to,
  );
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

function emitRrfTrace(
  onRetrievalTrace: SearchChunksInput["onRetrievalTrace"],
  input: { vectorCandidates: SearchCandidate[]; keywordCandidates: SearchCandidate[]; fused: RetrievedChunk[]; topK: number },
) {
  const vectorKeys = new Set(input.vectorCandidates.map(candidateKey));
  const keywordKeys = new Set(input.keywordCandidates.map(candidateKey));
  const overlapCount = [...vectorKeys].filter((key) => keywordKeys.has(key)).length;
  emitRetrievalTrace(onRetrievalTrace, {
    type: "rrf_fusion",
    topK: input.topK,
    rrfK: 60,
    vectorCount: input.vectorCandidates.length,
    keywordCount: input.keywordCandidates.length,
    overlapCount,
    returnedCount: input.fused.length,
    candidates: summarizeFusedCandidates(input.fused),
  });
}

function emitRetrievalTrace(onRetrievalTrace: SearchChunksInput["onRetrievalTrace"], event: RetrievalTraceEvent) {
  try {
    onRetrievalTrace?.(event);
  } catch (error) {
    createLogger({ component: "doris.chunk-store" }).warn("retrieval trace observer failed", { error: serializeError(error) });
  }
}

function summarizeBranchCandidates(candidates: SearchCandidate[]): RetrievalTraceCandidate[] {
  return candidates.map((chunk, index) => ({
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    rank: index + 1,
    score: chunk.branchScore,
    title: chunk.title,
    sourceUri: chunk.sourceUri,
  }));
}

function summarizeFusedCandidates(chunks: RetrievedChunk[]): RetrievalTraceCandidate[] {
  return chunks.map((chunk, index) => ({
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    rank: index + 1,
    score: chunk.score,
    title: chunk.title,
    sourceUri: chunk.sourceUri,
    vectorScore: chunk.retrieval?.vectorScore,
    keywordScore: chunk.retrieval?.keywordScore,
    vectorRank: chunk.retrieval?.vectorRank,
    keywordRank: chunk.retrieval?.keywordRank,
    fusionScore: chunk.retrieval?.fusionScore,
    fusionRank: chunk.retrieval?.fusionRank,
    matchedBy: chunk.retrieval?.matchedBy,
  }));
}

function candidateKey(candidate: Pick<RetrievedChunk, "documentId" | "chunkId">) {
  return `${candidate.documentId}:${candidate.chunkId}`;
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
    .map(({ bestRank: _bestRank, ...chunk }, index) => {
      const fusionScore = chunk.score;
      return {
        ...chunk,
        retrieval: {
          ...chunk.retrieval,
          fusionScore,
          fusionRank: index + 1,
        },
      };
    });
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

function normalizeExplicitCandidateK(candidateK: number | undefined, topK: number) {
  if (candidateK === undefined || !Number.isFinite(candidateK)) return normalizeTopK(topK);
  return Math.min(Math.max(Math.trunc(candidateK), normalizeTopK(topK)), 100);
}

function normalizeBatchSize(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 1000);
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
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
