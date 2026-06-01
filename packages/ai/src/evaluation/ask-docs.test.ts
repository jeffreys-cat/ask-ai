import { describe, expect, it } from "vitest";
import {
  normalizeAskDocsEvalItem,
  scoreAnswerHelpfulness,
  scoreCitationCorrectness,
  scoreGroundedness,
  scoreLanguageConsistency,
  scoreRefusalCorrectness,
  scoreRetrievalRecall,
  type AskDocsEvalOutput,
} from "./ask-docs";

const output = {
  answer: "Set OPENAI_API_KEY and CHAT_MODEL before starting the service [1].",
  citations: [
    {
      id: "1",
      documentId: "doc-config",
      chunkId: "doc-config:0",
      title: "Configuration",
      excerpt: "OPENAI_API_KEY and CHAT_MODEL are required.",
    },
  ],
  retrievedChunks: [
    {
      organizationId: "org-1",
      documentId: "doc-config",
      chunkId: "doc-config:0",
      content: "OPENAI_API_KEY and CHAT_MODEL are required.",
      metadata: {},
      score: 0.9,
    },
  ],
} satisfies AskDocsEvalOutput;

describe("ask docs eval scoring", () => {
  it("normalizes Litefuse dataset item shape", () => {
    const item = normalizeAskDocsEvalItem({
      input: { question: "Which env vars are required?", projectId: "project-1", tags: ["config"] },
      expectedOutput: { expectedAnswer: "OPENAI_API_KEY and CHAT_MODEL are required.", expectedCitationDocIds: ["doc-config"] },
      metadata: { critical: true },
    });

    expect(item.input.question).toBe("Which env vars are required?");
    expect(item.expectedOutput?.expectedCitationDocIds).toEqual(["doc-config"]);
    expect(item.metadata?.critical).toBe(true);
  });

  it("scores retrieval, groundedness, citations, helpfulness, and refusal behavior", () => {
    const params = {
      input: { question: "Which env vars are required?" },
      expected: {
        expectedAnswer: "OPENAI_API_KEY and CHAT_MODEL are required.",
        expectedCitationDocIds: ["doc-config"],
        mustInclude: ["OPENAI_API_KEY", "CHAT_MODEL"],
      },
      metadata: {},
      output,
    };

    expect(scoreRetrievalRecall(params).value).toBe(1);
    expect(scoreGroundedness(params).value).toBe(1);
    expect(scoreCitationCorrectness(params).value).toBe(1);
    expect(scoreAnswerHelpfulness(params).value).toBeGreaterThan(0.5);
    expect(scoreRefusalCorrectness(params).value).toBe(1);
    expect(scoreLanguageConsistency(params).value).toBe(1);
  });

  it("scores answer language consistency with the input question", () => {
    const baseParams = {
      expected: {},
      metadata: {},
      output: {
        answer: "需要先设置 OPENAI_API_KEY，然后启动服务。",
        citations: [],
        retrievedChunks: [],
      },
    };

    expect(scoreLanguageConsistency({ ...baseParams, input: { question: "需要配置哪些环境变量？" } }).value).toBe(1);
    expect(scoreLanguageConsistency({ ...baseParams, input: { question: "Which env vars are required?" } }).value).toBe(0);
    expect(
      scoreLanguageConsistency({
        ...baseParams,
        input: { question: "需要配置哪些环境变量？" },
        output: { ...baseParams.output, answer: "Set OPENAI_API_KEY before starting the service." },
      }).value,
    ).toBe(0);
  });

  it("scores no-context refusal as correct only without citations", () => {
    const params = {
      input: { question: "What is not in the docs?" },
      expected: { shouldRefuse: true },
      metadata: {},
      output: {
        answer: "I do not have enough document context to answer.",
        citations: [],
        retrievedChunks: [],
      },
    };

    expect(scoreGroundedness(params).value).toBe(1);
    expect(scoreRefusalCorrectness(params).value).toBe(1);
    expect(scoreCitationCorrectness(params).value).toBe(1);
  });
});
