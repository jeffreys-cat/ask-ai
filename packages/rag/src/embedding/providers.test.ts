import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleEmbeddingProvider, normalizeVector, validateEmbeddingDimensions } from "./providers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("embedding providers", () => {
  it("normalizes vectors", () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
  });

  it("rejects dimension mismatches", () => {
    expect(() => validateEmbeddingDimensions([1, 2], 3)).toThrow("Embedding dimension mismatch");
  });

  it("returns an empty embedding list without calling the API for empty input", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.test/v1",
      apiKey: "key",
      model: "embed",
      dimensions: 2,
    });

    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("splits embedding requests into batches", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(
        JSON.stringify({
          data: body.input.map(() => ({ embedding: [3, 4] })),
        }),
        { status: 200 },
      );
    });
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.test/v1",
      apiKey: "key",
      model: "embed",
      dimensions: 2,
      batchSize: 10,
    });

    const embeddings = await provider.embed(Array.from({ length: 25 }, (_, index) => `chunk ${index}`));

    expect(embeddings).toHaveLength(25);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).input.length)).toEqual([10, 10, 5]);
  });
});
