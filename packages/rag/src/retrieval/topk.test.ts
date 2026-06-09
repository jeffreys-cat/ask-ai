import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTopKFromEnv, normalizeTopK } from "./topk";

describe("topK normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 3 when TOPK is not configured", () => {
    expect(normalizeTopK(undefined, {} as NodeJS.ProcessEnv)).toBe(3);
  });

  it("reads TOPK from environment", () => {
    expect(defaultTopKFromEnv({ TOPK: "7" } as NodeJS.ProcessEnv)).toBe(7);
  });

  it("falls back to 3 when TOPK is invalid", () => {
    expect(defaultTopKFromEnv({ TOPK: "invalid" } as NodeJS.ProcessEnv)).toBe(3);
  });

  it("uses env default when input topK is missing or invalid", () => {
    expect(normalizeTopK(undefined, { TOPK: "4" } as NodeJS.ProcessEnv)).toBe(4);
    expect(normalizeTopK(NaN, { TOPK: "4" } as NodeJS.ProcessEnv)).toBe(4);
  });
});
