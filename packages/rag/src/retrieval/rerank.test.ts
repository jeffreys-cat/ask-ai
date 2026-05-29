import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "@selectdb/shared";
import { createDashScopeReranker, rerankChunks, rerankerFromEnv, type Reranker } from "./rerank";

const chunks: RetrievedChunk[] = [
  {
    organizationId: "org-1",
    documentId: "doc-a",
    chunkId: "a",
    content: "First candidate",
    metadata: { version: "3.0" },
    score: 0.8,
    retrieval: { mode: "hybrid", matchedBy: ["vector"], fusionScore: 0.8, fusionRank: 1 },
  },
  {
    organizationId: "org-1",
    documentId: "doc-b",
    chunkId: "b",
    content: "Second candidate",
    metadata: { version: "3.1" },
    score: 0.7,
    retrieval: { mode: "hybrid", matchedBy: ["keyword"], fusionScore: 0.7, fusionRank: 2 },
  },
];

describe("rerankChunks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("orders chunks by provider results and preserves chunk metadata", async () => {
    const reranker: Reranker = {
      provider: "test",
      model: "test-reranker",
      rerank: vi.fn(async () => [
        { index: 1, score: 0.97 },
        { index: 0, score: 0.12 },
      ]),
    };

    const result = await rerankChunks({
      query: "Which candidate is second?",
      chunks,
      topK: 1,
      reranker,
    });

    expect(result).toMatchObject({ usedRerank: true, fallback: false });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      documentId: "doc-b",
      chunkId: "b",
      metadata: { version: "3.1" },
      score: 0.97,
      retrieval: {
        fusionScore: 0.7,
        fusionRank: 2,
        rerank: {
          provider: "test",
          model: "test-reranker",
          score: 0.97,
          rank: 1,
        },
      },
    });
  });

  it("falls back to RRF order when the provider fails", async () => {
    const reranker: Reranker = {
      provider: "test",
      model: "broken",
      rerank: vi.fn(async () => {
        throw new Error("reranker unavailable");
      }),
    };

    const result = await rerankChunks({
      query: "fallback",
      chunks,
      topK: 2,
      reranker,
    });

    expect(result).toMatchObject({ usedRerank: false, fallback: true, error: "reranker unavailable" });
    expect(result.chunks.map((chunk) => chunk.chunkId)).toEqual(["a", "b"]);
    expect(result.chunks[0]?.retrieval?.rerank).toBeUndefined();
  });

  it("creates Qwen reranker requests with the unified env config", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ results: [{ index: 1, relevance_score: 0.91 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const reranker = rerankerFromEnv({
      RERANK_PROVIDER: "qwen",
      RERANK_API_KEY: "test-key",
      RERANK_MODEL: "qwen3-rerank",
      RERANK_BASE_URL: "https://dashscope.test",
      RERANK_INSTRUCT: "Rank documentation chunks by answer relevance.",
    });

    await expect(reranker?.rerank({ query: "query", chunks, topK: 1 })).resolves.toEqual([{ index: 1, score: 0.91 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.test/compatible-api/v1/reranks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
        body: JSON.stringify({
          model: "qwen3-rerank",
          query: "query",
          documents: ["First candidate", "Second candidate"],
          top_n: 1,
          instruct: "Rank documentation chunks by answer relevance.",
        }),
      }),
    );
  });

  it("supports the DashScope native rerank response shape", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ output: { results: [{ index: 0, relevance_score: 0.88 }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const reranker = createDashScopeReranker({ apiKey: "test-key", baseUrl: "https://dashscope.test" });

    await expect(reranker.rerank({ query: "query", chunks, topK: 1 })).resolves.toEqual([{ index: 0, score: 0.88 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.test/api/v1/services/rerank/text-rerank/text-rerank",
      expect.objectContaining({
        body: JSON.stringify({
          model: "qwen3-rerank",
          input: { query: "query", documents: ["First candidate", "Second candidate"] },
          parameters: { top_n: 1, return_documents: false },
        }),
      }),
    );
  });

  it("defaults to Qwen when only a generic rerank API key is configured", () => {
    expect(rerankerFromEnv({ RERANK_API_KEY: "test-key" })).toMatchObject({
      provider: "qwen",
      model: "qwen3-rerank",
    });
  });
});
