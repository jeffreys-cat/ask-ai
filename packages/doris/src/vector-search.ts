import type { AccessContext, MetadataFilters, RetrievedChunk } from "@selectdb/shared";
import type { DorisPool } from "./client";
import { createChunkStore } from "./chunk-store";

export async function searchDocumentChunks(
  pool: DorisPool,
  input: {
    organizationId: string;
    query: string;
    queryEmbedding: number[];
    topK: number;
    documentIds?: string[];
    filters?: MetadataFilters;
    accessContext?: AccessContext;
  },
): Promise<RetrievedChunk[]> {
  return createChunkStore(pool).searchChunks(input);
}
