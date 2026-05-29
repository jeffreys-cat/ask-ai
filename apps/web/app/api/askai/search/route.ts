import { NextResponse } from "next/server";
import { runAskDocsWorkflow, mastra } from "@selectdb/ai";
import { createAskRepo, createDocumentsRepo, createProjectApiKeysRepo, createProjectsRepo, hashProjectApiKey, isProjectApiKey } from "@selectdb/db";
import { createChunkStore } from "@selectdb/doris";
import { embeddingProviderFromEnv } from "@selectdb/rag";
import { BadRequestError, UnauthorizedError, type AskStreamEvent, type MetadataFilters } from "@selectdb/shared";
import { parseMetadataFilters } from "../../../../lib/metadata-filters";
import { getDb, getDoris } from "../../../../lib/runtime";

export async function POST(request: Request) {
  try {
    const apiKey = getBearerToken(request.headers);
    const body = (await request.json()) as { query?: string; topK?: number; filters?: unknown };
    const query = body.query?.trim();
    const topK = body.topK ?? 8;
    const filters = parseMetadataFilters(body.filters);

    if (!query) throw new BadRequestError("query is required");
    if (!Number.isInteger(topK) || topK <= 0 || topK > 50) throw new BadRequestError("topK must be an integer between 1 and 50");

    const db = getDb();
    const key = await createProjectApiKeysRepo(db).findActiveByHash(hashProjectApiKey(apiKey));
    if (!key) throw new UnauthorizedError("Invalid API key");
    const project = await createProjectsRepo(db).findById(key.organizationId, key.projectId);
    if (!project) throw new BadRequestError("project not found");
    if (project.status !== "ready") throw new BadRequestError("project is not ready");

    const documents = await createDocumentsRepo(db).listReadyByProject(key.organizationId, key.projectId);
    if (documents.length === 0) throw new BadRequestError("project has no ready documents");

    const askRepo = createAskRepo(db);
    const sessionId = crypto.randomUUID();
    await askRepo.createSession({
      id: sessionId,
      organizationId: key.organizationId,
      userId: `api-key:${key.id}`,
      question: query,
      metadata: {
        projectId: key.projectId,
        documentIds: documents.map((document) => document.id),
        topK,
        filters,
        apiKeyId: key.id,
        retrievalMode: "hybrid+rrf+rerank",
      },
    });

    const { answer, citations } = await runProjectSearch({
      organizationId: key.organizationId,
      projectId: key.projectId,
      query,
      topK,
      filters,
      apiKeyId: key.id,
      documentIds: documents.map((document) => document.id),
    });
    await askRepo.completeSession({ sessionId, answer, citations });
    await createProjectApiKeysRepo(db).touchLastUsed(key.id);

    return NextResponse.json({ answer, citations, sessionId });
  } catch (error) {
    return errorResponse(error);
  }
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("authorization");
  const [scheme, token] = authorization?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || !isProjectApiKey(token)) {
    throw new UnauthorizedError("Missing or invalid API key");
  }
  return token;
}

async function runProjectSearch(input: {
  organizationId: string;
  projectId: string;
  query: string;
  topK: number;
  filters?: MetadataFilters;
  apiKeyId: string;
  documentIds: string[];
}) {
  let answer = "";
  let citations: Extract<AskStreamEvent, { type: "citations" }>["citations"] = [];

  for await (const event of runAskDocsWorkflow({
    organizationId: input.organizationId,
    question: input.query,
    retriever: {
      search: (searchInput) => createChunkStore(getDoris()).searchChunks(searchInput),
    },
    embeddings: embeddingProviderFromEnv(),
    documentIds: input.documentIds,
    filters: input.filters,
    accessContext: { apiKeyId: input.apiKeyId },
    topK: input.topK,
    includeDebugChunks: false,
    agent: mastra.agents.docAnswerAgent,
  })) {
    if (event.type === "answer_delta") answer += event.delta;
    if (event.type === "citations") citations = event.citations;
    if (event.type === "done") answer = event.answer;
    if (event.type === "error") throw new Error(event.message);
  }

  return { answer, citations };
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
