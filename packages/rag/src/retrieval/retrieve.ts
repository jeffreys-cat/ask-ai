import type { AccessContext, MetadataFilters, RetrievedChunk } from "@selectdb/shared";
import type { EmbeddingProvider } from "../embedding";
import { rerankChunks } from "./rerank";

export interface Retriever {
  search(input: {
    organizationId: string;
    query: string;
    queryEmbedding: number[];
    topK: number;
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
}) {
  const [queryEmbedding] = await input.embeddings.embed([input.question]);
  if (!queryEmbedding) return [];
  const chunks = await input.retriever.search({
    organizationId: input.organizationId,
    query: input.question,
    queryEmbedding,
    topK: input.topK ?? 8,
    documentIds: input.documentIds,
    filters: input.filters,
    accessContext: input.accessContext,
  });
  return rerankChunks(chunks);
}
