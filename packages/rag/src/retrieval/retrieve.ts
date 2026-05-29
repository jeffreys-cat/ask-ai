import type { AccessContext, MetadataFilters, RetrievedChunk } from "@selectdb/shared";
import type { EmbeddingProvider } from "../embedding";
import { normalizeRerankCandidateK, rerankChunks, type Reranker } from "./rerank";

export interface Retriever {
  search(input: {
    organizationId: string;
    query: string;
    queryEmbedding: number[];
    topK: number;
    candidateK?: number;
    documentIds?: string[];
    filters?: MetadataFilters;
    accessContext?: AccessContext;
  }): Promise<RetrievedChunk[]>;
}

export async function retrieveRelevantChunks(input: {
  retriever: Retriever;
  embeddings: EmbeddingProvider;
  organizationId: string;
  question: string;
  topK?: number;
  documentIds?: string[];
  filters?: MetadataFilters;
  accessContext?: AccessContext;
  reranker?: Reranker;
  candidateK?: number;
  rerankFailOpen?: boolean;
}) {
  const topK = normalizeRetrieveTopK(input.topK);
  const candidates = await retrieveChunkCandidates({
    ...input,
    topK,
    candidateK: input.reranker ? normalizeRerankCandidateK(topK, input.candidateK) : input.candidateK,
  });
  const result = await rerankChunks({
    query: input.question,
    chunks: candidates,
    topK,
    reranker: input.reranker,
    failOpen: input.rerankFailOpen,
  });
  return result.chunks;
}

export async function retrieveChunkCandidates(input: {
  retriever: Retriever;
  embeddings: EmbeddingProvider;
  organizationId: string;
  question: string;
  topK?: number;
  candidateK?: number;
  documentIds?: string[];
  filters?: MetadataFilters;
  accessContext?: AccessContext;
}): Promise<RetrievedChunk[]> {
  const [queryEmbedding] = await input.embeddings.embed([input.question]);
  if (!queryEmbedding) return [];
  const searchInput: Parameters<Retriever["search"]>[0] = {
    organizationId: input.organizationId,
    query: input.question,
    queryEmbedding,
    topK: normalizeRetrieveTopK(input.topK),
    documentIds: input.documentIds,
    filters: input.filters,
    accessContext: input.accessContext,
  };
  if (input.candidateK !== undefined) searchInput.candidateK = input.candidateK;
  return input.retriever.search(searchInput);
}

function normalizeRetrieveTopK(topK: number | undefined) {
  if (topK === undefined || !Number.isFinite(topK)) return 8;
  return Math.min(Math.max(Math.trunc(topK), 1), 50);
}
