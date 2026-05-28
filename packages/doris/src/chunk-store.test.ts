import { describe, expect, it, vi } from "vitest";
import { createChunkStore, fuseRetrievedChunks, normalizeCandidateK } from "./chunk-store";

const baseChunk = {
  organizationId: "org-1",
  content: "Hybrid search combines vector and keyword retrieval.",
  metadata: {},
  score: 0,
  branchScore: 0,
};

describe("hybrid chunk retrieval", () => {
  it("fuses vector and keyword rankings with RRF and merges duplicate chunks", () => {
    const chunks = fuseRetrievedChunks({
      vector: [
        { ...baseChunk, documentId: "doc-a", chunkId: "a", score: 0.9, branchScore: 0.9 },
        { ...baseChunk, documentId: "doc-b", chunkId: "b", score: 0.8, branchScore: 0.8 },
      ],
      keyword: [
        { ...baseChunk, documentId: "doc-b", chunkId: "b", score: 12, branchScore: 12 },
        { ...baseChunk, documentId: "doc-c", chunkId: "c", score: 8, branchScore: 8 },
      ],
      topK: 3,
    });

    expect(chunks.map((chunk) => chunk.chunkId)).toEqual(["b", "a", "c"]);
    expect(chunks[0]).toMatchObject({
      documentId: "doc-b",
      retrieval: {
        mode: "hybrid",
        vectorScore: 0.8,
        keywordScore: 12,
        vectorRank: 2,
        keywordRank: 1,
        matchedBy: ["vector", "keyword"],
      },
    });
  });

  it("supports vector-only and keyword-only candidates", () => {
    const chunks = fuseRetrievedChunks({
      vector: [{ ...baseChunk, documentId: "doc-vector", chunkId: "vector", score: 0.7, branchScore: 0.7 }],
      keyword: [{ ...baseChunk, documentId: "doc-keyword", chunkId: "keyword", score: 4, branchScore: 4 }],
      topK: 2,
    });

    expect(chunks).toEqual([
      expect.objectContaining({ chunkId: "keyword", retrieval: expect.objectContaining({ matchedBy: ["keyword"] }) }),
      expect.objectContaining({ chunkId: "vector", retrieval: expect.objectContaining({ matchedBy: ["vector"] }) }),
    ]);
  });

  it("bounds candidateK from normalized topK", () => {
    expect(normalizeCandidateK(1)).toBe(20);
    expect(normalizeCandidateK(8)).toBe(32);
    expect(normalizeCandidateK(50)).toBe(50);
    expect(normalizeCandidateK(500)).toBe(50);
  });

  it("falls back to vector candidates when keyword search fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            organizationId: "org-1",
            documentId: "doc-vector",
            chunkId: "vector",
            content: "Vector result",
            metadata: "{}",
            vectorScore: 0.91,
          },
        ],
      ])
      .mockRejectedValueOnce(new Error("MATCH_ANY is unavailable"));
    const store = createChunkStore({ execute } as never);

    try {
      const chunks = await store.searchChunks({
        organizationId: "org-1",
        query: "OPENAI_API_KEY",
        queryEmbedding: [1, 0],
        topK: 8,
      });

      expect(execute).toHaveBeenCalledTimes(2);
      expect(chunks).toEqual([
        expect.objectContaining({
          documentId: "doc-vector",
          chunkId: "vector",
          retrieval: expect.objectContaining({
            vectorScore: 0.91,
            vectorRank: 1,
            matchedBy: ["vector"],
          }),
        }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
