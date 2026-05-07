import type { RetrievedChunk } from "@selectdb/shared";

export function rerankChunks(chunks: RetrievedChunk[]) {
  return [...chunks].sort((a, b) => b.score - a.score);
}
