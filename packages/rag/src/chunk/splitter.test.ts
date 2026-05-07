import { describe, expect, it } from "vitest";
import { splitTextIntoChunks } from "./splitter";

describe("splitTextIntoChunks", () => {
  it("produces stable ordered chunks with offsets", () => {
    const chunks = splitTextIntoChunks("Alpha paragraph.\n\nBeta paragraph has more words.", {
      documentId: "doc-1",
      maxChars: 20,
      overlapChars: 4,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({
      chunkId: "doc-1:0",
      order: 0,
      startOffset: 0,
    });
    expect(chunks[1]?.order).toBe(1);
  });
});
