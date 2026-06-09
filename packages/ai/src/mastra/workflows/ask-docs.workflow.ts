import { SpanType } from "@mastra/core/observability";
import { createLogger, serializeError } from "@selectdb/logger";
import type { AccessContext, AskAgentInput, AskStreamEvent, Citation, MetadataFilters, RetrievalTraceEvent, RetrievedChunk } from "@selectdb/shared";
import {
  buildCitations,
  packContext,
  normalizeTopK,
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
import { queryRewriteFailOpenFromEnv, requestRewriterFromEnv, type RequestRewriter } from "../../rewrite/request-rewriter";

type ObservabilitySpan = NonNullable<ReturnType<NonNullable<ReturnType<typeof mastra.observability.getDefaultInstance>>["startSpan"]>>;

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
  requestRewriter?: RequestRewriter | null;
  queryRewriteFailOpen?: boolean;
  reranker?: Reranker | null;
  rerankCandidateK?: number;
  rerankFailOpen?: boolean;
  requestId?: string;
}

export async function* runAskDocsWorkflow(input: AskDocsWorkflowInput): AsyncGenerator<AskStreamEvent> {
  const workflowStartedAt = performance.now();
  const requestId = input.requestId ?? crypto.randomUUID();
  const noContextExperiment = envFlag("ASK_AI_EXPERIMENT_NO_CONTEXT");
  const experimentMaxOutputTokens =
    numberFromEnv(process.env.ASK_AI_EXPERIMENT_MAX_OUTPUT_TOKENS) ?? numberFromEnv(process.env.CHAT_MAX_TOKENS);
  const log = createLogger({
    component: "ai.ask-docs.workflow",
    requestId,
    organizationId: input.organizationId,
  });
  const observability = mastra.observability.getDefaultInstance();
  const queryRewriteRequested =
    input.requestRewriter !== null && (input.requestRewriter !== undefined || process.env.QUERY_REWRITE_ENABLED?.toLowerCase() === "true");
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
      queryRewriteEnabled: queryRewriteRequested,
      experimentNoContext: noContextExperiment,
      experimentMaxOutputTokens,
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
      queryRewriteEnabled: queryRewriteRequested,
      experimentNoContext: noContextExperiment,
      experimentMaxOutputTokens,
    },
  });
  let chunks: RetrievedChunk[] = [];
  let citations: Citation[] = [];
  let answer = "";
  let failed = false;
  log.info("ask workflow started", {
    questionLength: input.question.length,
    documentCount: input.documentIds?.length ?? 0,
    hasFilters: Boolean(input.filters),
    topK: input.topK,
    includeDebugChunks: Boolean(input.includeDebugChunks),
    queryRewriteRequested,
    experimentNoContext: noContextExperiment,
    experimentMaxOutputTokens,
  });

  try {
    const topK = normalizeTopK(input.topK);
    const requestRewriter = input.requestRewriter === null ? undefined : (input.requestRewriter ?? requestRewriterFromEnv());
    const queryRewriteFailOpen = input.queryRewriteFailOpen ?? queryRewriteFailOpenFromEnv();
    const rewriteStartedAt = performance.now();
    const retrievalQuery = await resolveRetrievalQuery({
      question: input.question,
      requestRewriter,
      failOpen: queryRewriteFailOpen,
      rootSpan,
    });
    log.info("ask timing query rewrite", {
      latencyMs: elapsed(rewriteStartedAt),
      workflowElapsedMs: elapsed(workflowStartedAt),
      enabled: Boolean(requestRewriter),
      changed: retrievalQuery.query !== input.question,
      fallback: Boolean(retrievalQuery.fallback),
      error: retrievalQuery.error,
    });
    if (requestRewriter) {
      yield {
        type: "request_rewrite",
        originalQuestion: input.question,
        query: retrievalQuery.query,
        changed: retrievalQuery.query !== input.question,
        fallback: retrievalQuery.fallback,
        error: retrievalQuery.error,
      };
    }
    const reranker = input.reranker === null ? undefined : (input.reranker ?? rerankerFromEnv());
    const rerankCandidateK = reranker ? (input.rerankCandidateK ?? rerankCandidateKFromEnv(topK)) : undefined;
    const rerankFailOpen = input.rerankFailOpen ?? rerankFailOpenFromEnv();
    log.info("ask retrieval configured", {
      workflowElapsedMs: elapsed(workflowStartedAt),
      topK,
      candidateK: rerankCandidateK,
      rerankProvider: reranker?.provider ?? "none",
      rerankModel: reranker?.model,
      rerankFailOpen,
      experimentNoContext: noContextExperiment,
    });
    if (!noContextExperiment) {
      const retrievalSpan = rootSpan?.createChildSpan({
        name: "Retrieve document chunk candidates",
        type: SpanType.RAG_VECTOR_OPERATION,
        entityId: "retrieve-docs",
        entityName: "Retrieve document chunk candidates",
        input: {
          question: retrievalQuery.query,
          originalQuestion: input.question,
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
          queryRewrite: requestRewriter
            ? {
                provider: requestRewriter.provider,
                model: requestRewriter.model,
                changed: retrievalQuery.query !== input.question,
                fallback: retrievalQuery.fallback,
                error: retrievalQuery.error,
              }
            : undefined,
        },
      });
      const retrievalTraceParent = retrievalSpan ?? rootSpan;
      const recordRetrievalTrace = (event: RetrievalTraceEvent) => {
        if (event.type === "vector_candidates") {
          log.info("ask timing vector search", {
            latencyMs: event.latencyMs,
            workflowElapsedMs: elapsed(workflowStartedAt),
            topK: event.topK,
            candidateK: event.candidateK,
            returnedCount: event.returnedCount,
          });
          const span = retrievalTraceParent?.createChildSpan({
            name: "Vector search candidates",
            type: SpanType.RAG_VECTOR_OPERATION,
            entityId: "vector-search",
            entityName: "Vector search candidates",
            input: { topK: event.topK, candidateK: event.candidateK },
            attributes: {
              operation: "query",
              store: "doris-vector",
              indexName: "document_chunks",
              topK: event.topK,
            },
            metadata: {
              retrievalStage: "vector",
              candidateK: event.candidateK,
              returnedCount: event.returnedCount,
              latencyMs: event.latencyMs,
            },
          });
          span?.end({
            output: {
              returnedCount: event.returnedCount,
              latencyMs: event.latencyMs,
              topChunkIds: event.candidates.map((candidate) => candidate.chunkId),
              candidates: event.candidates,
            },
          });
          return;
        }

        if (event.type === "keyword_candidates") {
          log.info("ask timing keyword search", {
            latencyMs: event.latencyMs,
            workflowElapsedMs: elapsed(workflowStartedAt),
            topK: event.topK,
            candidateK: event.candidateK,
            returnedCount: event.returnedCount,
            fallback: Boolean(event.fallback),
            error: event.error,
          });
          const span = retrievalTraceParent?.createChildSpan({
            name: "BM25 keyword candidates",
            type: SpanType.RAG_VECTOR_OPERATION,
            entityId: "bm25-keyword-search",
            entityName: "BM25 keyword candidates",
            input: { query: event.query, topK: event.topK, candidateK: event.candidateK },
            attributes: {
              operation: "query",
              store: "doris-bm25",
              indexName: "document_chunks",
              topK: event.topK,
            },
            metadata: {
              retrievalStage: "bm25",
              candidateK: event.candidateK,
              returnedCount: event.returnedCount,
              fallback: event.fallback,
              error: event.error,
              latencyMs: event.latencyMs,
            },
          });
          span?.end({
            output: {
              returnedCount: event.returnedCount,
              fallback: event.fallback,
              error: event.error,
              latencyMs: event.latencyMs,
              topChunkIds: event.candidates.map((candidate) => candidate.chunkId),
              candidates: event.candidates,
            },
          });
          return;
        }

        log.info("ask timing rrf fusion", {
          workflowElapsedMs: elapsed(workflowStartedAt),
          topK: event.topK,
          rrfK: event.rrfK,
          vectorCount: event.vectorCount,
          keywordCount: event.keywordCount,
          overlapCount: event.overlapCount,
          returnedCount: event.returnedCount,
        });
        const span = retrievalTraceParent?.createChildSpan({
          name: "RRF fusion",
          type: SpanType.GENERIC,
          entityId: "rrf-fusion",
          entityName: "RRF fusion",
          input: {
            topK: event.topK,
            rrfK: event.rrfK,
            vectorCount: event.vectorCount,
            keywordCount: event.keywordCount,
            overlapCount: event.overlapCount,
          },
          metadata: {
            retrievalStage: "rrf",
            rrfK: event.rrfK,
            vectorCount: event.vectorCount,
            keywordCount: event.keywordCount,
            overlapCount: event.overlapCount,
            returnedCount: event.returnedCount,
          },
        });
        span?.end({
          output: {
            returnedCount: event.returnedCount,
            topChunkIds: event.candidates.map((candidate) => candidate.chunkId),
            candidates: event.candidates,
          },
        });
      };

      try {
        const retrieveStartedAt = performance.now();
        chunks = await retrieveChunkCandidates({
          retriever: input.retriever,
          embeddings: timedEmbeddingProvider(input.embeddings, log, workflowStartedAt),
          organizationId: input.organizationId,
          question: retrievalQuery.query,
          topK,
          candidateK: rerankCandidateK,
          documentIds: input.documentIds,
          filters: input.filters,
          accessContext: input.accessContext,
          onRetrievalTrace: recordRetrievalTrace,
        });
        log.info("ask timing retrieval total", {
          latencyMs: elapsed(retrieveStartedAt),
          workflowElapsedMs: elapsed(workflowStartedAt),
          chunkCount: chunks.length,
          documentCount: [...new Set(chunks.map((chunk) => chunk.documentId))].length,
        });
        retrievalSpan?.end({
          output: {
            chunkCount: chunks.length,
            documentIds: [...new Set(chunks.map((chunk) => chunk.documentId))],
          },
        });
      } catch (error) {
        log.warn("ask retrieval failed", {
          workflowElapsedMs: elapsed(workflowStartedAt),
          error: serializeError(error),
        });
        retrievalSpan?.error({ error: asError(error) });
        throw error;
      }

      const rerankSpan = rootSpan?.createChildSpan({
        name: "Rerank document chunk candidates",
        type: SpanType.RAG_ACTION,
        entityId: "rerank-docs",
        entityName: "Rerank document chunk candidates",
        input: {
          question: retrievalQuery.query,
          originalQuestion: input.question,
          candidateCount: chunks.length,
          candidateDocumentIds: [...new Set(chunks.map((chunk) => chunk.documentId))],
          topK,
          provider: reranker?.provider ?? "none",
          model: reranker?.model,
        },
        attributes: {
          action: "rerank",
          candidateCount: chunks.length,
          topN: topK,
          scorer: reranker?.provider ?? "none",
        },
        metadata: {
          operation: "rerank",
          provider: reranker?.provider ?? "none",
          model: reranker?.model,
          endpoint: reranker?.observability?.endpoint,
          timeoutMs: reranker?.observability?.timeoutMs,
          maxDocChars: reranker?.observability?.maxDocChars,
          candidateCount: chunks.length,
          topK,
          candidateK: rerankCandidateK,
          failOpen: rerankFailOpen,
          retrievalMode: reranker ? "hybrid+rrf+rerank" : "hybrid+rrf",
          enabled: Boolean(reranker),
        },
      });

      try {
        const startedAt = performance.now();
        const candidateCount = chunks.length;
        const result = await rerankChunks({
          query: retrievalQuery.query,
          chunks,
          topK,
          reranker,
          failOpen: rerankFailOpen,
        });
        chunks = result.chunks;
        log.info("ask timing rerank", {
          latencyMs: elapsed(startedAt),
          workflowElapsedMs: elapsed(workflowStartedAt),
          provider: reranker?.provider ?? "none",
          model: reranker?.model,
          candidateCount,
          chunkCount: chunks.length,
          usedRerank: result.usedRerank,
          fallback: result.fallback,
          error: result.error,
        });
        rerankSpan?.end({
          output: {
            chunkCount: chunks.length,
            usedRerank: result.usedRerank,
            fallback: result.fallback,
            error: result.error,
            latencyMs: elapsed(startedAt),
            provider: reranker?.provider ?? "none",
            model: reranker?.model,
            topChunkIds: chunks.map((chunk) => chunk.chunkId),
            topDocumentIds: [...new Set(chunks.map((chunk) => chunk.documentId))],
            rerankScores: chunks
              .map((chunk) => chunk.retrieval?.rerank?.score)
              .filter((score): score is number => typeof score === "number"),
          },
        });
      } catch (error) {
        log.warn("ask rerank failed", {
          workflowElapsedMs: elapsed(workflowStartedAt),
          provider: reranker?.provider ?? "none",
          model: reranker?.model,
          error: serializeError(error),
        });
        rerankSpan?.error({ error: asError(error) });
        throw error;
      }

      if (input.includeDebugChunks) {
        yield { type: "retrieved_chunks", chunks };
      }
    } else {
      log.info("ask experiment no-context enabled", {
        workflowElapsedMs: elapsed(workflowStartedAt),
        agentName: input.agent?.name ?? "doc-answer",
      });
    }

    citations = noContextExperiment ? [] : buildCitations(chunks);
    const promptBuildStartedAt = performance.now();
    const promptResult = await buildDocAnswerMessages({
      question: input.question,
      context: noContextExperiment ? "" : packContext(chunks),
      citations,
      agent: input.agent,
    });

    const baseChatConfig = input.chat ?? chatConfigFromEnv();
    const chatConfig = {
      ...baseChatConfig,
      maxTokens: experimentMaxOutputTokens ?? baseChatConfig.maxTokens,
    };
    log.info("ask timing prompt built", {
      latencyMs: elapsed(promptBuildStartedAt),
      workflowElapsedMs: elapsed(workflowStartedAt),
      model: chatConfig.model,
      messageCount: promptResult.messages.length,
      contextCharCount: promptResult.messages.reduce((total, message) => total + message.content.length, 0),
      citationCount: citations.length,
      chunkCount: chunks.length,
    });
    log.info("ask generation configured", {
      workflowElapsedMs: elapsed(workflowStartedAt),
      model: chatConfig.model,
      provider: providerFromBaseUrl(chatConfig.baseUrl),
      chunkCount: chunks.length,
      citationCount: citations.length,
    });
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
      let promptTokenCount: number | null = null;
      let completionTokenCount: number | null = null;
      let totalTokenCount: number | null = null;
      let generationResponseHeadersLatencyMs: number | null = null;
      let generationFirstPayloadLatencyMs: number | null = null;
      let generationFirstDeltaLatencyMs: number | null = null;
      const generationStartedAt = performance.now();
      log.info("ask timing generation request started", {
        workflowElapsedMs: elapsed(workflowStartedAt),
        model: chatConfig.model,
        maxTokens: chatConfig.maxTokens ?? null,
      });
      for await (const delta of streamOpenAICompatibleChat(
        chatConfig,
        promptResult.messages,
        ({ usage }) => {
          if (!usage) return;
          if (typeof usage.prompt_tokens === "number") {
            promptTokenCount = usage.prompt_tokens;
          }
          if (typeof usage.completion_tokens === "number") {
            completionTokenCount = usage.completion_tokens;
          }
          if (typeof usage.total_tokens === "number") {
            totalTokenCount = usage.total_tokens;
          }
        },
        {
          onResponseHeaders: ({ latencyMs, status, contentType }) => {
            generationResponseHeadersLatencyMs = latencyMs;
            log.info("ask timing generation response headers", {
              latencyMs,
              workflowElapsedMs: elapsed(workflowStartedAt),
              model: chatConfig.model,
              maxTokens: chatConfig.maxTokens ?? null,
              status,
              contentType,
            });
          },
          onFirstPayload: ({ latencyMs, hasDelta, hasUsage }) => {
            generationFirstPayloadLatencyMs = latencyMs;
            log.info("ask timing generation first payload", {
              latencyMs,
              workflowElapsedMs: elapsed(workflowStartedAt),
              model: chatConfig.model,
              maxTokens: chatConfig.maxTokens ?? null,
              hasDelta,
              hasUsage,
            });
          },
          onFirstDelta: ({ latencyMs, deltaLength }) => {
            generationFirstDeltaLatencyMs = latencyMs;
            log.info("ask timing generation first content delta", {
              latencyMs,
              workflowElapsedMs: elapsed(workflowStartedAt),
              model: chatConfig.model,
              maxTokens: chatConfig.maxTokens ?? null,
              deltaLength,
            });
          },
          onUsage: ({ latencyMs, usage }) => {
            log.info("ask timing generation usage chunk", {
              latencyMs,
              workflowElapsedMs: elapsed(workflowStartedAt),
              model: chatConfig.model,
              maxTokens: chatConfig.maxTokens ?? null,
              promptTokenCount: usage.prompt_tokens ?? null,
              completionTokenCount: usage.completion_tokens ?? null,
              totalTokenCount: usage.total_tokens ?? null,
            });
          },
        },
      )) {
        if (!completionStarted) {
          completionStarted = true;
          log.info("ask timing generation first delta", {
            latencyMs: elapsed(generationStartedAt),
            workflowElapsedMs: elapsed(workflowStartedAt),
            model: chatConfig.model,
          });
          modelSpan?.update({ attributes: { completionStartTime: new Date() } });
        }
        answer += delta;
        yield { type: "answer_delta", delta };
      }
      log.info("ask timing generation total", {
        latencyMs: elapsed(generationStartedAt),
        workflowElapsedMs: elapsed(workflowStartedAt),
        model: chatConfig.model,
        maxTokens: chatConfig.maxTokens ?? null,
        answerLength: answer.length,
        promptTokenCount,
        completionTokenCount,
        totalTokenCount,
      });
      log.info("ask timing generation summary", {
        workflowElapsedMs: elapsed(workflowStartedAt),
        model: chatConfig.model,
        maxTokens: chatConfig.maxTokens ?? null,
        responseHeadersMs: generationResponseHeadersLatencyMs,
        firstPayloadMs: generationFirstPayloadLatencyMs,
        firstDeltaMs: generationFirstDeltaLatencyMs,
        outputTokens: completionTokenCount,
        promptTokens: promptTokenCount,
        totalTokens: totalTokenCount,
        tailMs:
          generationFirstDeltaLatencyMs !== null
            ? elapsed(generationStartedAt) - generationFirstDeltaLatencyMs
            : null,
      });
      modelSpan?.end({
        output: answer,
        attributes: { finishReason: "stop" },
      });
    } catch (error) {
      log.warn("ask generation failed", {
        workflowElapsedMs: elapsed(workflowStartedAt),
        model: chatConfig.model,
        error: serializeError(error),
      });
      modelSpan?.error({ error: asError(error) });
      throw error;
    }

    yield { type: "citations", citations };
    yield { type: "done", answer };
    log.info("ask workflow completed", {
      workflowElapsedMs: elapsed(workflowStartedAt),
      answerLength: answer.length,
      citationCount: citations.length,
      chunkCount: chunks.length,
    });
    rootSpan?.end({
      output: {
        answer,
        citationCount: citations.length,
        chunkCount: chunks.length,
      },
    });
  } catch (error) {
    failed = true;
    log.warn("ask workflow failed", {
      workflowElapsedMs: elapsed(workflowStartedAt),
      error: serializeError(error),
    });
    rootSpan?.error({ error: asError(error) });
    yield { type: "error", message: error instanceof Error ? error.message : "Unknown ask workflow error" };
  } finally {
    if (!failed && rootSpan?.isValid && !rootSpan.endTime) {
      rootSpan.end({ output: { answer, citationCount: citations.length, chunkCount: chunks.length } });
    }
    await observability?.flush();
  }
}

function timedEmbeddingProvider(provider: EmbeddingProvider, log: ReturnType<typeof createLogger>, workflowStartedAt: number): EmbeddingProvider {
  return {
    async embed(texts) {
      const startedAt = performance.now();
      try {
        const vectors = await provider.embed(texts);
        log.info("ask timing embedding", {
          latencyMs: elapsed(startedAt),
          workflowElapsedMs: elapsed(workflowStartedAt),
          inputCount: texts.length,
          vectorCount: vectors.length,
          dimensions: vectors[0]?.length ?? 0,
        });
        return vectors;
      } catch (error) {
        log.warn("ask embedding failed", {
          latencyMs: elapsed(startedAt),
          workflowElapsedMs: elapsed(workflowStartedAt),
          inputCount: texts.length,
          error: serializeError(error),
        });
        throw error;
      }
    },
  };
}

function envFlag(name: string) {
  return process.env[name]?.toLowerCase() === "true";
}

function numberFromEnv(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

async function resolveRetrievalQuery(input: {
  question: string;
  requestRewriter?: RequestRewriter;
  failOpen: boolean;
  rootSpan?: ObservabilitySpan;
}) {
  if (!input.requestRewriter) return { query: input.question };

  const span = input.rootSpan?.createChildSpan({
    name: "Rewrite request for retrieval",
    type: SpanType.MODEL_GENERATION,
    entityId: "query-rewrite",
    entityName: "Query rewrite",
    input: { question: input.question },
    attributes: {
      model: input.requestRewriter.model,
      provider: input.requestRewriter.provider,
      resultType: "planning",
      streaming: false,
    },
    metadata: {
      failOpen: input.failOpen,
    },
  });

  try {
    const query = await input.requestRewriter.rewrite({ question: input.question });
    span?.end({
      output: { query, changed: query !== input.question },
    });
    return { query };
  } catch (error) {
    span?.error({ error: asError(error) });
    if (!input.failOpen) throw error;
    const message = error instanceof Error ? error.message : String(error);
    span?.end({
      output: { query: input.question, fallback: true, error: message },
    });
    return { query: input.question, fallback: true, error: message };
  }
}
