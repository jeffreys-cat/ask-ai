import { SpanType } from "@mastra/core/observability";
import type { AccessContext, AskAgentInput, AskStreamEvent, Citation, MetadataFilters, RetrievedChunk } from "@selectdb/shared";
import {
  buildCitations,
  packContext,
  rerankCandidateKFromEnv,
  rerankerFromEnv,
  rerankChunks,
  rerankFailOpenFromEnv,
  retrieveChunkCandidates,
  type EmbeddingProvider,
  type Reranker,
  type Retriever,
} from "@selectdb/rag";
import { mastra } from "../index";
import { buildDocAnswerMessages } from "../agents/doc-answer.agent";
import { chatConfigFromEnv, streamOpenAICompatibleChat, type ChatStreamConfig } from "../../streaming/answer-stream";

export interface AskDocsWorkflowInput {
  organizationId: string;
  question: string;
  retriever: Retriever;
  embeddings: EmbeddingProvider;
  documentIds?: string[];
  filters?: MetadataFilters;
  accessContext?: AccessContext;
  topK?: number;
  includeDebugChunks?: boolean;
  agent?: AskAgentInput;
  chat?: ChatStreamConfig;
  reranker?: Reranker | null;
  rerankCandidateK?: number;
  rerankFailOpen?: boolean;
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
      filters: input.filters,
      topK: input.topK,
      retrievalMode: "hybrid+rrf+rerank",
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
      filters: input.filters,
      topK: input.topK,
      includeDebugChunks: input.includeDebugChunks,
      retrievalMode: "hybrid+rrf+rerank",
    },
  });
  let chunks: RetrievedChunk[] = [];
  let citations: Citation[] = [];
  let answer = "";
  let failed = false;

  try {
    const topK = normalizeWorkflowTopK(input.topK);
    const reranker = input.reranker === null ? undefined : (input.reranker ?? rerankerFromEnv());
    const rerankCandidateK = reranker ? (input.rerankCandidateK ?? rerankCandidateKFromEnv(topK)) : undefined;
    const rerankFailOpen = input.rerankFailOpen ?? rerankFailOpenFromEnv();
    const retrievalSpan = rootSpan?.createChildSpan({
      name: "Retrieve document chunk candidates",
      type: SpanType.RAG_VECTOR_OPERATION,
      input: {
        question: input.question,
        organizationId: input.organizationId,
        documentIds: input.documentIds,
        filters: input.filters,
        topK,
        candidateK: rerankCandidateK,
      },
      attributes: {
        operation: "query",
        store: "doris",
        indexName: "document_chunks",
        topK,
      },
      metadata: {
        organizationId: input.organizationId,
        documentIds: input.documentIds,
        filters: input.filters,
        topK,
        candidateK: rerankCandidateK,
        retrievalMode: reranker ? "hybrid+rrf+rerank" : "hybrid+rrf",
      },
    });

    try {
      chunks = await retrieveChunkCandidates({
        retriever: input.retriever,
        embeddings: input.embeddings,
        organizationId: input.organizationId,
        question: input.question,
        topK,
        candidateK: rerankCandidateK,
        documentIds: input.documentIds,
        filters: input.filters,
        accessContext: input.accessContext,
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

    const rerankSpan = rootSpan?.createChildSpan({
      name: "Rerank document chunk candidates",
      type: SpanType.RAG_VECTOR_OPERATION,
      input: {
        question: input.question,
        candidateCount: chunks.length,
        topK,
      },
      attributes: {
        operation: "query",
        store: reranker?.provider ?? "none",
        indexName: "document_chunks",
        topK,
      },
      metadata: {
        provider: reranker?.provider ?? "none",
        model: reranker?.model,
        topK,
        candidateK: rerankCandidateK,
        failOpen: rerankFailOpen,
        retrievalMode: reranker ? "hybrid+rrf+rerank" : "hybrid+rrf",
      },
    });

    try {
      const startedAt = performance.now();
      const result = await rerankChunks({
        query: input.question,
        chunks,
        topK,
        reranker,
        failOpen: rerankFailOpen,
      });
      chunks = result.chunks;
      rerankSpan?.end({
        output: {
          chunkCount: chunks.length,
          usedRerank: result.usedRerank,
          fallback: result.fallback,
          error: result.error,
          latencyMs: elapsed(startedAt),
        },
      });
    } catch (error) {
      rerankSpan?.error({ error: asError(error) });
      throw error;
    }

    if (input.includeDebugChunks) {
      yield { type: "retrieved_chunks", chunks };
    }

    citations = buildCitations(chunks);
    const promptResult = await buildDocAnswerMessages({
      question: input.question,
      context: packContext(chunks),
      citations,
      agent: input.agent,
    });

    const chatConfig = input.chat ?? chatConfigFromEnv();
    const modelSpan = rootSpan?.createChildSpan({
      name: "Generate answer",
      type: SpanType.MODEL_GENERATION,
      input: { messages: promptResult.messages, citationCount: citations.length, chunkCount: chunks.length },
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
        langfuse: promptResult.litefusePrompt ? { prompt: promptResult.litefusePrompt } : undefined,
      },
    });

    try {
      let completionStarted = false;
      for await (const delta of streamOpenAICompatibleChat(chatConfig, promptResult.messages)) {
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

function normalizeWorkflowTopK(topK: number | undefined) {
  if (topK === undefined || !Number.isFinite(topK)) return 8;
  return Math.min(Math.max(Math.trunc(topK), 1), 50);
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
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
