import type { RetrievedChunk } from "@selectdb/shared";
import type { EmbeddingProvider } from "../embedding";
import { rerankChunks } from "./rerank";

export interface Retriever {
  search(input: {
    organizationId: string;
    queryEmbedding: number[];
    topK: number;
    documentIds?: string[];
  }): Promise<RetrievedChunk[]>;
}

export async function retrieveRelevantChunks(input: {
  retriever: Retriever;
  embeddings: EmbeddingProvider;
  organizationId: string;
  question: string;
  topK?: number;
  documentIds?: string[];
}) {
  const [queryEmbedding] = await input.embeddings.embed([input.question]);
  if (!queryEmbedding) return [];
  const chunks = await input.retriever.search({
    organizationId: input.organizationId,
    queryEmbedding,
    topK: input.topK ?? 8,
    documentIds: input.documentIds,
  });
  return rerankChunks(chunks);
}
