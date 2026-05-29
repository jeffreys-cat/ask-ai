import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { createAskRepo, createDb, createDocumentsRepo, createProjectsRepo } from "@selectdb/db";
import { createChunkStore, createDorisPool } from "@selectdb/doris";
import {
  ASK_DOCS_EVAL_DATASET_NAME,
  createAskDocsEvaluators,
  createAskDocsRunEvaluators,
  getLitefuseClient,
  mastra,
  normalizeAskDocsEvalItem,
  requestRewriterFromEnv,
  runAskDocsWorkflow,
  type AskDocsEvalInput,
  type AskDocsEvalOutput,
  type AskDocsEvalExpected,
  type AskDocsEvalMetadata,
} from "@selectdb/ai";
import { embeddingProviderFromEnv } from "@selectdb/rag";
import type { Citation, RetrievedChunk } from "@selectdb/shared";
import type { ExperimentItem, ExperimentTaskParams } from "@langfuse/client";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getLitefuseClient();
  if (!client) throw new Error("LITEFUSE_PUBLIC_KEY and LITEFUSE_SECRET_KEY are required to run evals");

  const db = createDb();
  const doris = createDorisPool();
  const askRepo = createAskRepo(db);
  const runName = args.runName ?? process.env.LITEFUSE_EVAL_RUN_NAME ?? `ask-docs-${new Date().toISOString()}`;
  const datasetName = args.dataset ?? process.env.LITEFUSE_EVAL_DATASET ?? ASK_DOCS_EVAL_DATASET_NAME;
  const minItems = numberFrom(args.minItems ?? process.env.LITEFUSE_EVAL_MIN_ITEMS, 30);

  try {
    const task = createAskDocsTask({
      db,
      doris,
      askRepo,
      defaultOrganizationId: process.env.LITEFUSE_EVAL_ORGANIZATION_ID,
      defaultTopK: numberFrom(process.env.LITEFUSE_EVAL_TOP_K, 8),
    });
    const experiment = {
      name: "Ask AI docs quality",
      runName,
      description: "Evaluates document Q&A retrieval, groundedness, citations, helpfulness, and refusal behavior.",
      metadata: {
        datasetName,
        promptLabel: process.env.LITEFUSE_PROMPT_LABEL,
        promptVersion: process.env.LITEFUSE_PROMPT_VERSION,
        release: process.env.LITEFUSE_RELEASE ?? process.env.APP_VERSION ?? process.env.GIT_COMMIT,
      },
      task,
      evaluators: createAskDocsEvaluators(),
      runEvaluators: createAskDocsRunEvaluators(),
      maxConcurrency: numberFrom(args.maxConcurrency ?? process.env.LITEFUSE_EVAL_MAX_CONCURRENCY, 2),
      datasetVersion: args.datasetVersion ?? process.env.LITEFUSE_EVAL_DATASET_VERSION,
    };

    const result = args.local
      ? await runLocalExperiment({ client, file: args.local, minItems, experiment })
      : await runLitefuseDatasetExperiment({ client, datasetName, minItems, experiment });

    console.log(await result.format({ includeItemResults: args.includeItems === "true" }));
    const gate = result.runEvaluations.find((evaluation) => evaluation.name === "regression_gate");
    if (gate?.value !== 1) {
      throw new Error("Ask docs eval regression gate failed");
    }
  } finally {
    await client.flush();
    await doris.end();
    await db.end();
  }
}

async function runLocalExperiment(input: {
  client: NonNullable<ReturnType<typeof getLitefuseClient>>;
  file: string;
  minItems: number;
  experiment: Omit<Parameters<NonNullable<ReturnType<typeof getLitefuseClient>>["experiment"]["run"]>[0], "data">;
}) {
  const data = await readLocalItems(input.file);
  if (data.length < input.minItems) {
    throw new Error(`Local eval file ${input.file} has ${data.length} items; expected at least ${input.minItems}`);
  }
  return input.client.experiment.run({ ...input.experiment, data });
}

async function runLitefuseDatasetExperiment(input: {
  client: NonNullable<ReturnType<typeof getLitefuseClient>>;
  datasetName: string;
  minItems: number;
  experiment: Omit<Parameters<NonNullable<ReturnType<typeof getLitefuseClient>>["experiment"]["run"]>[0], "data">;
}) {
  const dataset = await input.client.dataset.get(input.datasetName);
  if (dataset.items.length < input.minItems) {
    throw new Error(`Dataset ${input.datasetName} has ${dataset.items.length} items; expected at least ${input.minItems}`);
  }
  return dataset.runExperiment(input.experiment);
}

async function readLocalItems(path: string): Promise<ExperimentItem<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const object = raw && typeof raw === "object" ? (raw as { items?: unknown }) : {};
  const items = Array.isArray(raw) ? raw : Array.isArray(object.items) ? object.items : [];
  if (items.length === 0) throw new Error(`No eval items found in ${path}`);
  return items.map((item) => normalizeAskDocsEvalItem(item as { input?: unknown; expectedOutput?: unknown; metadata?: unknown }));
}

function createAskDocsTask(input: {
  db: ReturnType<typeof createDb>;
  doris: ReturnType<typeof createDorisPool>;
  askRepo: ReturnType<typeof createAskRepo>;
  defaultOrganizationId?: string;
  defaultTopK: number;
}) {
  return async (params: ExperimentTaskParams<unknown, unknown, Record<string, unknown>>): Promise<AskDocsEvalOutput> => {
    const item = normalizeAskDocsEvalItem(params);
    const organizationId = item.input.organizationId ?? input.defaultOrganizationId;
    if (!organizationId) throw new Error("Eval item organizationId or LITEFUSE_EVAL_ORGANIZATION_ID is required");

    const documentIds = await resolveDocumentIds({
      db: input.db,
      organizationId,
      projectId: item.input.projectId,
      documentIds: item.input.documentIds,
    });
    const sessionId = crypto.randomUUID();
    await input.askRepo.createSession({
      id: sessionId,
      organizationId,
      userId: "eval:litefuse",
      question: item.input.question,
      metadata: {
        eval: true,
        projectId: item.input.projectId,
        documentIds,
        topK: item.input.topK ?? input.defaultTopK,
        retrievalMode: "hybrid+rrf+rerank",
        tags: item.metadata?.tags,
      },
    });

    const startedAt = performance.now();
    let answer = "";
    let citations: Citation[] = [];
    let retrievedChunks: RetrievedChunk[] = [];

    for await (const event of runAskDocsWorkflow({
      organizationId,
      question: item.input.question,
      retriever: {
        search: (searchInput) => createChunkStore(input.doris).searchChunks(searchInput),
      },
      embeddings: embeddingProviderFromEnv(),
      documentIds,
      topK: item.input.topK ?? input.defaultTopK,
      includeDebugChunks: true,
      agent: mastra.agents.docAnswerAgent,
      requestRewriter: requestRewriterFromEnv(),
    })) {
      if (event.type === "answer_delta") answer += event.delta;
      if (event.type === "retrieved_chunks") retrievedChunks = event.chunks;
      if (event.type === "citations") citations = event.citations;
      if (event.type === "done") answer = event.answer;
      if (event.type === "error") {
        return { answer, citations, retrievedChunks, latencyMs: elapsed(startedAt), error: event.message };
      }
    }

    if (answer) await input.askRepo.completeSession({ sessionId, answer, citations });
    return { answer, citations, retrievedChunks, latencyMs: elapsed(startedAt) };
  };
}

async function resolveDocumentIds(input: {
  db: ReturnType<typeof createDb>;
  organizationId: string;
  projectId?: string;
  documentIds?: string[];
}) {
  if (input.documentIds?.length) return input.documentIds;
  if (!input.projectId) return undefined;

  const project = await createProjectsRepo(input.db).findById(input.organizationId, input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const documents = await createDocumentsRepo(input.db).listReadyByProject(input.organizationId, input.projectId);
  if (documents.length === 0) throw new Error(`Project has no ready documents: ${input.projectId}`);
  return documents.map((document) => document.id);
}

function parseArgs(args: string[]) {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) continue;
    const normalized = key.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = args[index + 1];
    parsed[normalized] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed as {
    dataset?: string;
    datasetVersion?: string;
    includeItems?: string;
    local?: string;
    maxConcurrency?: string;
    minItems?: string;
    runName?: string;
  };
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function numberFrom(value: string | number | undefined, fallback: number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
