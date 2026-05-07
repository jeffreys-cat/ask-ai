import { describe, expect, it } from "vitest";
import { normalizeVector, validateEmbeddingDimensions } from "./providers";

describe("embedding providers", () => {
  it("normalizes vectors", () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
  });

  it("rejects dimension mismatches", () => {
    expect(() => validateEmbeddingDimensions([1, 2], 3)).toThrow("Embedding dimension mismatch");
  });
});
