import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "@selectdb/shared";

describe("runAskDocsWorkflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("streams retrieved chunks, answers, and citations through the real workflow shape", async () => {
    vi.stubEnv("LITEFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LITEFUSE_SECRET_KEY", "");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse("Use OPENAI_API_KEY and CHAT_MODEL [1].")),
    );

    const { runAskDocsWorkflow } = await import("./ask-docs.workflow");
    const chunks: RetrievedChunk[] = [
      {
        organizationId: "org-1",
        documentId: "doc-config",
        chunkId: "doc-config:0",
        content: "OPENAI_API_KEY and CHAT_MODEL are required.",
        metadata: {},
        score: 0.9,
      },
    ];

    const search = vi.fn(async () => chunks);
    const events = [];
    for await (const event of runAskDocsWorkflow({
      organizationId: "org-1",
      question: "Which config keys are required?",
      retriever: { search },
      embeddings: { embed: async () => [[1, 0]] },
      filters: { productLine: "cloud", publishedAt: { from: "2026-01-01T00:00:00.000Z" } },
      accessContext: { userId: "user-1" },
      includeDebugChunks: true,
      chat: { baseUrl: "https://chat.test/v1", apiKey: "test-key", model: "test-model" },
    })) {
      events.push(event);
    }

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { productLine: "cloud", publishedAt: { from: "2026-01-01T00:00:00.000Z" } },
        accessContext: { userId: "user-1" },
      }),
    );
    expect(events.find((event) => event.type === "retrieved_chunks")).toMatchObject({ chunks });
    expect(events.find((event) => event.type === "citations")).toMatchObject({
      citations: [expect.objectContaining({ documentId: "doc-config" })],
    });
    expect(events.find((event) => event.type === "done")).toMatchObject({
      answer: "Use OPENAI_API_KEY and CHAT_MODEL [1].",
    });
  });

  it("builds a no-context prompt when retrieval returns no chunks", async () => {
    vi.stubEnv("LITEFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LITEFUSE_SECRET_KEY", "");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    const fetchMock = vi.fn<typeof fetch>(
      async () => streamResponse("I do not have enough document context to answer."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { runAskDocsWorkflow } = await import("./ask-docs.workflow");
    const events = [];
    for await (const event of runAskDocsWorkflow({
      organizationId: "org-1",
      question: "Who owns the undocumented feature?",
      retriever: { search: async () => [] },
      embeddings: { embed: async () => [[1, 0]] },
      chat: { baseUrl: "https://chat.test/v1", apiKey: "test-key", model: "test-model" },
    })) {
      events.push(event);
    }

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse(String(firstCall?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(body.messages.map((message) => message.content).join("\n")).toContain("retrieval step returned no relevant context");
    expect(events.find((event) => event.type === "done")).toMatchObject({
      answer: "I do not have enough document context to answer.",
    });
  });
});

function streamResponse(content: string) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}
