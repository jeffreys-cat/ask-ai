import { describe, expect, it } from "vitest";
import { buildCitations } from "./build-citations";

describe("buildCitations", () => {
  it("maps chunks into citation previews", () => {
    const [citation] = buildCitations([
      {
        organizationId: "org",
        documentId: "doc",
        chunkId: "chunk",
        content: "A long enough source excerpt",
        title: "Doc title",
        metadata: {},
        score: 0.9,
      },
    ]);

    expect(citation).toMatchObject({
      id: "1",
      documentId: "doc",
      chunkId: "chunk",
      title: "Doc title",
    });
  });
});
