import { createAskRepo, createDocumentsRepo, createProjectsRepo } from "@selectdb/db";
import { createChunkStore } from "@selectdb/doris";
import { runAskDocsWorkflow } from "@selectdb/ai";
import { embeddingProviderFromEnv } from "@selectdb/rag";
import { BadRequestError, type AskStreamEvent } from "@selectdb/shared";
import { getRequestContext } from "../../../lib/auth";
import { getDb, getDoris } from "../../../lib/runtime";

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  try {
    const ctx = getRequestContext(request.headers);
    const body = (await request.json()) as {
      question?: string;
      projectId?: string;
      documentIds?: string[];
      topK?: number;
      includeDebugChunks?: boolean;
    };

    if (!body.question?.trim()) throw new BadRequestError("question is required");

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
      question: body.question.trim(),
      metadata: { projectId: body.projectId, documentIds, topK: body.topK },
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let finalAnswer = "";
        let finalCitations: Extract<AskStreamEvent, { type: "citations" }>["citations"] = [];

        const emit = (event: AskStreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        for await (const event of runAskDocsWorkflow({
          organizationId: ctx.organizationId,
          question: body.question!.trim(),
          retriever: {
            search: (input) => createChunkStore(getDoris()).searchChunks(input),
          },
          embeddings: embeddingProviderFromEnv(),
          documentIds,
          topK: body.topK,
          includeDebugChunks: body.includeDebugChunks,
        })) {
          if (event.type === "done") finalAnswer = event.answer;
          if (event.type === "citations") finalCitations = event.citations;
          emit(event);
        }

        if (finalAnswer) {
          await askRepo.completeSession({ sessionId, answer: finalAnswer, citations: finalCitations });
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    const event: AskStreamEvent = { type: "error", message: error instanceof Error ? error.message : "Unknown error" };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, {
      status: error instanceof BadRequestError ? error.status : 500,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }
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
