import { SpanType } from "@mastra/core/observability";
import type { AskAgentInput, AskStreamEvent, Citation, RetrievedChunk } from "@selectdb/shared";
import { buildCitations, packContext, retrieveRelevantChunks, type EmbeddingProvider, type Retriever } from "@selectdb/rag";
import { mastra } from "../index";
import { buildDocAnswerPrompt } from "../agents/doc-answer.agent";
import { chatConfigFromEnv, streamOpenAICompatibleAnswer, type ChatStreamConfig } from "../../streaming/answer-stream";

export interface AskDocsWorkflowInput {
  organizationId: string;
  question: string;
  retriever: Retriever;
  embeddings: EmbeddingProvider;
  documentIds?: string[];
  topK?: number;
  includeDebugChunks?: boolean;
  agent?: AskAgentInput;
  chat?: ChatStreamConfig;
}

export async function* runAskDocsWorkflow(input: AskDocsWorkflowInput): AsyncGenerator<AskStreamEvent> {
  const observability = mastra.observability.getDefaultInstance();
  const rootSpan = observability?.startSpan({
    name: "ASK AI document answer",
    type: SpanType.AGENT_RUN,
    entityId: input.agent?.id,
    entityName: input.agent?.name ?? "Documentation answer agent",
    input: {
      question: input.question,
      organizationId: input.organizationId,
      documentIds: input.documentIds,
      topK: input.topK,
    },
    tags: ["ask-ai", "litefuse"],
    attributes: {
      conversationId: input.organizationId,
      prompt: input.question,
      availableTools: ["retrieve-docs"],
    },
    metadata: {
      organizationId: input.organizationId,
      documentIds: input.documentIds,
      topK: input.topK,
      includeDebugChunks: input.includeDebugChunks,
    },
  });
  let chunks: RetrievedChunk[] = [];
  let citations: Citation[] = [];
  let answer = "";
  let failed = false;

  try {
    const retrievalSpan = rootSpan?.createChildSpan({
      name: "Retrieve relevant document chunks",
      type: SpanType.RAG_VECTOR_OPERATION,
      input: {
        question: input.question,
        organizationId: input.organizationId,
        documentIds: input.documentIds,
        topK: input.topK,
      },
      attributes: {
        operation: "query",
        store: "doris",
        indexName: "document_chunks",
        topK: input.topK,
      },
      metadata: {
        organizationId: input.organizationId,
        documentIds: input.documentIds,
        topK: input.topK,
      },
    });

    try {
      chunks = await retrieveRelevantChunks({
        retriever: input.retriever,
        embeddings: input.embeddings,
        organizationId: input.organizationId,
        question: input.question,
        topK: input.topK,
        documentIds: input.documentIds,
      });
      retrievalSpan?.end({
        output: {
          chunkCount: chunks.length,
          documentIds: [...new Set(chunks.map((chunk) => chunk.documentId))],
        },
      });
    } catch (error) {
      retrievalSpan?.error({ error: asError(error) });
      throw error;
    }

    if (input.includeDebugChunks) {
      yield { type: "retrieved_chunks", chunks };
    }

    citations = buildCitations(chunks);
    const prompt = buildDocAnswerPrompt({
      question: input.question,
      context: packContext(chunks),
      citations,
      agent: input.agent,
    });

    const chatConfig = input.chat ?? chatConfigFromEnv();
    const modelSpan = rootSpan?.createChildSpan({
      name: "Generate answer",
      type: SpanType.MODEL_GENERATION,
      input: { question: input.question, citationCount: citations.length, chunkCount: chunks.length },
      attributes: {
        model: chatConfig.model,
        provider: providerFromBaseUrl(chatConfig.baseUrl),
        resultType: "response_generation",
        streaming: true,
        serverAddress: chatConfig.baseUrl,
      },
      metadata: {
        citationCount: citations.length,
        chunkCount: chunks.length,
      },
    });

    try {
      let completionStarted = false;
      for await (const delta of streamOpenAICompatibleAnswer(chatConfig, prompt)) {
        if (!completionStarted) {
          completionStarted = true;
          modelSpan?.update({ attributes: { completionStartTime: new Date() } });
        }
        answer += delta;
        yield { type: "answer_delta", delta };
      }
      modelSpan?.end({
        output: answer,
        attributes: { finishReason: "stop" },
      });
    } catch (error) {
      modelSpan?.error({ error: asError(error) });
      throw error;
    }

    yield { type: "citations", citations };
    yield { type: "done", answer };
    rootSpan?.end({
      output: {
        answer,
        citationCount: citations.length,
        chunkCount: chunks.length,
      },
    });
  } catch (error) {
    failed = true;
    rootSpan?.error({ error: asError(error) });
    yield { type: "error", message: error instanceof Error ? error.message : "Unknown ask workflow error" };
  } finally {
    if (!failed && rootSpan?.isValid && !rootSpan.endTime) {
      rootSpan.end({ output: { answer, citationCount: citations.length, chunkCount: chunks.length } });
    }
    await observability?.flush();
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function providerFromBaseUrl(baseUrl: string) {
  try {
    const host = new URL(baseUrl).host;
    if (host.includes("openai.com")) return "openai";
    return host;
  } catch {
    return "openai-compatible";
  }
}
