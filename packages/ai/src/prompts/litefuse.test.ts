import { describe, expect, it, vi } from "vitest";

describe("Litefuse prompt rendering", () => {
  it("returns fallback chat messages when Litefuse credentials are absent", async () => {
    vi.resetModules();
    vi.stubEnv("LITEFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LITEFUSE_SECRET_KEY", "");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");

    const { renderLitefuseChatPrompt } = await import("./litefuse");
    const result = await renderLitefuseChatPrompt({
      name: "ask-ai-doc-answer",
      fallbackMessages: [
        { role: "system", content: "Use only context." },
        { role: "user", content: "Question: {{question}}" },
      ],
      variables: { question: "What is configured?" },
    });

    expect(result.litefusePrompt).toBeUndefined();
    expect(result.messages).toEqual([
      { role: "system", content: "Use only context." },
      { role: "user", content: "Question: {{question}}" },
    ]);
  });
});
