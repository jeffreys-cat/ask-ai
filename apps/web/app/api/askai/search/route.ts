import { NextResponse } from "next/server";
import { runAskDocsWorkflow, mastra, requestRewriterFromEnv } from "@selectdb/ai";
import { createAskRepo, createDocumentsRepo, createProjectApiKeysRepo, createProjectsRepo, hashProjectApiKey, isProjectApiKey } from "@selectdb/db";
import { createChunkStore } from "@selectdb/doris";
import { createLogger, serializeError } from "@selectdb/logger";
import { BadRequestError, UnauthorizedError, type AskStreamEvent, type MetadataFilters } from "@selectdb/shared";
import { DEFAULT_TOPK, normalizeTopK } from "@selectdb/rag";
import { parseMetadataFilters } from "../../../../lib/metadata-filters";
import { getDb, getDoris } from "../../../../lib/runtime";

export async function POST(request: Request) {
  const requestTopK = DEFAULT_TOPK;
  const requestId = crypto.randomUUID();
  const requestStartedAt = performance.now();
  let log = createLogger({ component: "web.api.askai.search", requestId });

  try {
    log.info("askai search request received");
    const apiKey = getBearerToken(request.headers);
    const parseStartedAt = performance.now();
    const body = (await request.json()) as { query?: string; topK?: number; filters?: unknown };
    const query = body.query?.trim();
    const topK = normalizeTopK(requestTopK);
    const filters = parseMetadataFilters(body.filters);
    log.info("askai search timing request parsed", {
      latencyMs: elapsed(parseStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      topK,
      hasFilters: Boolean(filters),
      queryLength: query?.length ?? 0,
    });

    if (!query) throw new BadRequestError("query is required");
    if (body.topK !== undefined && body.topK !== requestTopK) {
      log.warn("askai search request topK ignored", {
        requestedTopK: body.topK,
        effectiveTopK: topK,
      });
    }

    const db = getDb();
    const contextStartedAt = performance.now();
    const key = await createProjectApiKeysRepo(db).findActiveByHash(hashProjectApiKey(apiKey));
    if (!key) throw new UnauthorizedError("Invalid API key");
    log = log.child({ organizationId: key.organizationId, projectId: key.projectId, apiKeyId: key.id });
    const project = await createProjectsRepo(db).findById(key.organizationId, key.projectId);
    if (!project) throw new BadRequestError("project not found");
    if (project.status !== "ready") throw new BadRequestError("project is not ready");

    const documents = await createDocumentsRepo(db).listReadyByProject(key.organizationId, key.projectId);
    if (documents.length === 0) throw new BadRequestError("project has no ready documents");
    log.info("askai search timing context resolved", {
      latencyMs: elapsed(contextStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      documentCount: documents.length,
      topK,
      hasFilters: Boolean(filters),
    });

    const askRepo = createAskRepo(db);
    const sessionId = crypto.randomUUID();
    const sessionStartedAt = performance.now();
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
    log.info("askai search timing session created", {
      latencyMs: elapsed(sessionStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
      documentCount: documents.length,
    });

    log.info("askai search workflow started", {
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
      documentCount: documents.length,
    });
    const workflowStartedAt = performance.now();
    const { answer, citations } = await runProjectSearch({
      organizationId: key.organizationId,
      projectId: key.projectId,
      query,
      topK,
      filters,
      apiKeyId: key.id,
      documentIds: documents.map((document) => document.id),
      requestId,
    });
    log.info("askai search timing workflow completed", {
      latencyMs: elapsed(workflowStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
      answerLength: answer.length,
      citationCount: citations.length,
    });

    log.info("askai search session completion started", {
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
    });
    const completeStartedAt = performance.now();
    await askRepo.completeSession({ sessionId, answer, citations });
    log.info("askai search timing session completed", {
      latencyMs: elapsed(completeStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
    });

    log.info("askai search api key touch started", {
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
    });
    const touchStartedAt = performance.now();
    await createProjectApiKeysRepo(db).touchLastUsed(key.id);
    log.info("askai search timing api key touched", {
      latencyMs: elapsed(touchStartedAt),
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
    });

    log.info("askai search response returning", {
      totalElapsedMs: elapsed(requestStartedAt),
      sessionId,
      answerLength: answer.length,
      citationCount: citations.length,
    });

    return NextResponse.json({ answer, citations, sessionId });
  } catch (error) {
    log.warn("askai search request failed", {
      totalElapsedMs: elapsed(requestStartedAt),
      error: serializeError(error),
    });
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
  requestId: string;
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
    requestRewriter: requestRewriterFromEnv(),
    requestId: input.requestId,
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

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}
