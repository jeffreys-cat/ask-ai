import type { AskStreamEvent, Citation, RetrievedChunk } from "@selectdb/shared";
import { buildCitations, packContext, retrieveRelevantChunks, type EmbeddingProvider, type Retriever } from "@selectdb/rag";
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
  chat?: ChatStreamConfig;
}

export async function* runAskDocsWorkflow(input: AskDocsWorkflowInput): AsyncGenerator<AskStreamEvent> {
  let chunks: RetrievedChunk[] = [];
  let citations: Citation[] = [];
  let answer = "";

  try {
    chunks = await retrieveRelevantChunks({
      retriever: input.retriever,
      embeddings: input.embeddings,
      organizationId: input.organizationId,
      question: input.question,
      topK: input.topK,
      documentIds: input.documentIds,
    });

    if (input.includeDebugChunks) {
      yield { type: "retrieved_chunks", chunks };
    }

    citations = buildCitations(chunks);
    const prompt = buildDocAnswerPrompt({
      question: input.question,
      context: packContext(chunks),
      citations,
    });

    for await (const delta of streamOpenAICompatibleAnswer(input.chat ?? chatConfigFromEnv(), prompt)) {
      answer += delta;
      yield { type: "answer_delta", delta };
    }

    yield { type: "citations", citations };
    yield { type: "done", answer };
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : "Unknown ask workflow error" };
  }
}
