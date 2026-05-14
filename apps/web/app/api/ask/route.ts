import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { createAskRepo, createDocumentsRepo, createProjectsRepo } from "@selectdb/db";
import { createChunkStore } from "@selectdb/doris";
import { runAskDocsWorkflow } from "@selectdb/ai";
import { embeddingProviderFromEnv } from "@selectdb/rag";
import { BadRequestError, type AskStreamEvent } from "@selectdb/shared";
import { getRequestContext } from "../../../lib/auth";
import { getDb, getDoris } from "../../../lib/runtime";

export async function POST(request: Request) {
  try {
    const ctx = getRequestContext(request.headers);
    const body = (await request.json()) as {
      messages?: UIMessage[];
      question?: string;
      projectId?: string;
      documentIds?: string[];
      topK?: number;
      includeDebugChunks?: boolean;
    };
    const question = body.question?.trim() || getLatestUserText(body.messages);

    if (!question) throw new BadRequestError("question is required");

    const db = getDb();
    const documentIds = await resolveDocumentIds({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      documentIds: body.documentIds,
      db,
    });
    const sessionId = crypto.randomUUID();
    const askRepo = createAskRepo(db);
    await askRepo.createSession({
      id: sessionId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      question,
      metadata: { projectId: body.projectId, documentIds, topK: body.topK },
    });

    const stream = createUIMessageStream({
      originalMessages: body.messages,
      execute: async ({ writer }) => {
        let finalAnswer = "";
        let finalCitations: Extract<AskStreamEvent, { type: "citations" }>["citations"] = [];
        const textId = crypto.randomUUID();

        writer.write({ type: "data-status", data: { label: "Retrieving context" }, transient: true });
        writer.write({ type: "text-start", id: textId });

        for await (const event of runAskDocsWorkflow({
          organizationId: ctx.organizationId,
          question,
          retriever: {
            search: (input) => createChunkStore(getDoris()).searchChunks(input),
          },
          embeddings: embeddingProviderFromEnv(),
          documentIds,
          topK: body.topK,
          includeDebugChunks: body.includeDebugChunks,
        })) {
          if (event.type === "answer_delta") {
            writer.write({ type: "data-status", data: { label: "Answering" }, transient: true });
            writer.write({ type: "text-delta", id: textId, delta: event.delta });
          }
          if (event.type === "retrieved_chunks") {
            writer.write({ type: "data-retrieved_chunks", data: event.chunks });
          }
          if (event.type === "citations") {
            finalCitations = event.citations;
            writer.write({ type: "data-citations", data: event.citations });
          }
          if (event.type === "done") {
            finalAnswer = event.answer;
            writer.write({ type: "data-status", data: { label: "Done" }, transient: true });
          }
          if (event.type === "error") {
            writer.write({ type: "error", errorText: event.message });
          }
        }

        writer.write({ type: "text-end", id: textId });

        if (finalAnswer) {
          await askRepo.completeSession({ sessionId, answer: finalAnswer, citations: finalCitations });
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      {
      status: error instanceof BadRequestError ? error.status : 500,
      },
    );
  }
}

function getLatestUserText(messages?: UIMessage[]) {
  const message = [...(messages ?? [])].reverse().find((item) => item.role === "user");
  return message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function resolveDocumentIds(input: {
  organizationId: string;
  projectId?: string;
  documentIds?: string[];
  db: ReturnType<typeof getDb>;
}) {
  if (!input.projectId) return input.documentIds;

  const project = await createProjectsRepo(input.db).findById(input.organizationId, input.projectId);
  if (!project) throw new BadRequestError("project not found");

  const documents = await createDocumentsRepo(input.db).listReadyByProject(input.organizationId, input.projectId);
  if (documents.length === 0) throw new BadRequestError("project has no ready documents");
  return documents.map((document) => document.id);
}
