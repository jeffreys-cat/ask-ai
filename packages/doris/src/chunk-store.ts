import type { DocumentChunk, RetrievedChunk } from "@selectdb/shared";
import type { DorisPool } from "./client";
import { assertSqlIdentifier, vectorLiteral } from "./client";

export interface ChunkStoreOptions {
  table?: string;
}

export function createChunkStore(pool: DorisPool, options: ChunkStoreOptions = {}) {
  const table = assertSqlIdentifier(options.table ?? process.env.DORIS_CHUNKS_TABLE ?? "document_chunks");

  return {
    async upsertChunks(chunks: DocumentChunk[]) {
      if (chunks.length === 0) return;

      const values = chunks.map((chunk) => [
        chunk.organizationId,
        chunk.documentId,
        chunk.chunkId,
        chunk.content,
        chunk.title ?? null,
        chunk.sourceUri ?? null,
        JSON.stringify(chunk.metadata),
        JSON.stringify(chunk.embedding),
      ]);

      await pool.query(
        `INSERT INTO ${table}
          (organization_id, document_id, chunk_id, content, title, source_uri, metadata, embedding)
         VALUES ?`,
        [values],
      );
    },

    async deleteDocumentChunks(organizationId: string, documentId: string) {
      await pool.execute(`DELETE FROM ${table} WHERE organization_id = ? AND document_id = ?`, [organizationId, documentId]);
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

      const [rows] = await pool.execute(
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
