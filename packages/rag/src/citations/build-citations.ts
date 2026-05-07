import type { Citation, RetrievedChunk } from "@selectdb/shared";

export function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((chunk, index) => ({
    id: String(index + 1),
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    title: chunk.title ?? `Document ${chunk.documentId}`,
    excerpt: chunk.content.slice(0, 280),
    score: chunk.score,
    sourceUri: chunk.sourceUri,
  }));
}
