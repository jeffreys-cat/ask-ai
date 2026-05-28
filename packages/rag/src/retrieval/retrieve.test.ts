import { describe, expect, it, vi } from "vitest";
import { retrieveRelevantChunks } from "./retrieve";

describe("retrieveRelevantChunks", () => {
  it("passes the original question and query embedding to the retriever", async () => {
    const search = vi.fn(async () => [
      {
        organizationId: "org-1",
        documentId: "doc-1",
        chunkId: "chunk-1",
        content: "Hybrid search combines vector and keyword results.",
        metadata: {},
        score: 0.5,
      },
    ]);

    const chunks = await retrieveRelevantChunks({
      retriever: { search },
      embeddings: { embed: async () => [[1, 0]] },
      organizationId: "org-1",
      question: "What does hybrid search combine?",
      topK: 12,
      documentIds: ["doc-1"],
    });

    expect(search).toHaveBeenCalledWith({
      organizationId: "org-1",
      query: "What does hybrid search combine?",
      queryEmbedding: [1, 0],
      topK: 12,
      documentIds: ["doc-1"],
    });
    expect(chunks).toHaveLength(1);
  });

  it("returns no chunks when the embedding provider returns no embedding", async () => {
    const search = vi.fn();

    await expect(
      retrieveRelevantChunks({
        retriever: { search },
        embeddings: { embed: async () => [] },
        organizationId: "org-1",
        question: "missing embedding",
      }),
    ).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
