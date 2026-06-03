import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import type * as AiModule from "@selectdb/ai";
import type * as DbModule from "@selectdb/db";
import type * as DorisModule from "@selectdb/doris";
import type {
  AskDocsEvalInput,
  AskDocsEvalExpected,
  AskDocsEvalMetadata,
  AskDocsEvalOutput,
  AskDocsEvaluatorPreset,
} from "@selectdb/ai";
import type { Citation, RetrievedChunk } from "@selectdb/shared";
import type { Evaluation, ExperimentItem, ExperimentItemResult, ExperimentParams, ExperimentResult, ExperimentTaskParams } from "@langfuse/client";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

type Ai = typeof AiModule;
type Db = typeof DbModule;
type Doris = typeof DorisModule;
type Rag = typeof import("@selectdb/rag");
type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
const RETRIEVAL_EVAL_DATASET_NAME = "ask-ai-docs-retrieval-eval";
const ANSI_GREEN = "\u001b[32m";
const ANSI_RED = "\u001b[31m";
const ANSI_RESET = "\u001b[0m";

async function main() {
  const runtime = await loadRuntime();
  const { ai, db: dbModule, doris: dorisModule } = runtime;
  const tracerProvider = await setupLitefuseTracing(ai);
  const args = parseArgs(process.argv.slice(2));
  const client = ai.getLitefuseClient();
  if (!client && !args.local) throw new Error("LITEFUSE_PUBLIC_KEY and LITEFUSE_SECRET_KEY are required to run dataset evals");

  const db = dbModule.createDb();
  const doris = dorisModule.createDorisPool();
  const askRepo = dbModule.createAskRepo(db);
  const baseRunName = args.runName ?? process.env.LITEFUSE_EVAL_RUN_NAME ?? `ask-docs-${new Date().toISOString()}`;
  const datasetNames = resolveDatasetNames({ ai, args });
  const minItems = numberFrom(args.minItems ?? process.env.LITEFUSE_EVAL_MIN_ITEMS, 30);

  try {
    const task = createAskDocsTask({
      runtime,
      db,
      doris,
      askRepo,
      defaultOrganizationId: defaultEvalOrganizationId(),
      defaultTopK: numberFrom(process.env.LITEFUSE_EVAL_TOP_K, 8),
    });
    const summaries: DatasetRunSummary[] = [];
    for (const [index, datasetName] of datasetNames.entries()) {
      const evaluatorPreset = askDocsEvaluatorPreset(datasetName);
      const experiment = {
        name: "Ask AI docs quality",
        runName: datasetNames.length === 1 ? baseRunName : `${baseRunName}-${datasetName}`,
        description: "Evaluates document Q&A retrieval, groundedness, citations, helpfulness, and refusal behavior.",
        metadata: {
          datasetName,
          promptLabel: process.env.LITEFUSE_PROMPT_LABEL,
          promptVersion: process.env.LITEFUSE_PROMPT_VERSION,
          release: process.env.LITEFUSE_RELEASE ?? process.env.APP_VERSION ?? process.env.GIT_COMMIT,
          evaluatorPreset,
        },
        task,
        evaluators: ai.createAskDocsEvaluators(evaluatorPreset),
        runEvaluators: ai.createAskDocsRunEvaluators(
          evaluatorPreset === "rag" ? ai.RAG_ASK_DOCS_EVAL_THRESHOLDS : ai.DEFAULT_ASK_DOCS_EVAL_THRESHOLDS,
        ),
        maxConcurrency: numberFrom(args.maxConcurrency ?? process.env.LITEFUSE_EVAL_MAX_CONCURRENCY, 2),
        datasetVersion: args.datasetVersion ?? process.env.LITEFUSE_EVAL_DATASET_VERSION,
      };

      if (!args.local && datasetNames.length > 1) {
        console.log(`\nRunning dataset ${index + 1}/${datasetNames.length}: ${datasetName}`);
      }
      const result = args.local
        ? await runLocalExperiment({ client, file: args.local, minItems, experiment })
        : await runLitefuseDatasetExperiment({ client: requiredLitefuseClient(client), datasetName, minItems, experiment });

      console.log(await result.format({ includeItemResults: args.includeItems === "true" }));
      const summary = summarizeDatasetRun({ datasetName, result });
      summaries.push(summary);
      console.log(formatDatasetRunSummary(summary));
    }

    console.log(formatOverallSummary(summaries));
    const failures = summaries.filter((summary) => !summary.passed);
    if (failures.length > 0) {
      throw new Error(
        `Ask docs eval failed: ${failures.map((summary) => `${summary.datasetName} (${summary.failureReason})`).join("; ")}`,
      );
    }
  } finally {
    await client?.flush();
    await tracerProvider?.forceFlush();
    await tracerProvider?.shutdown();
    await doris.end();
    await db.end();
  }
}

async function loadRuntime() {
  const [ai, db, doris, rag] = await Promise.all([
    import("../packages/ai/src/index"),
    import("../packages/db/src/index"),
    import("../packages/doris/src/index"),
    import("../packages/rag/src/index"),
  ]);
  return { ai, db, doris, rag };
}

async function setupLitefuseTracing(ai: Ai) {
  if (!ai.litefuseConfig) return undefined;

  const [{ LangfuseSpanProcessor }, { NodeTracerProvider }] = await Promise.all([
    import("@langfuse/otel"),
    import("@opentelemetry/sdk-trace-node"),
  ]);
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: ai.litefuseConfig.publicKey,
        secretKey: ai.litefuseConfig.secretKey,
        baseUrl: ai.litefuseConfig.baseUrl,
        environment: ai.litefuseConfig.environment,
        release: ai.litefuseConfig.release,
      }),
    ],
  });
  provider.register();
  return provider;
}

function resolveDatasetNames(input: { ai: Ai; args: ReturnType<typeof parseArgs> }) {
  if (input.args.local) return [input.args.dataset ?? process.env.LITEFUSE_EVAL_DATASET ?? "local"];
  if (input.args.dataset) return [input.args.dataset];
  if (process.env.LITEFUSE_EVAL_DATASET) return [process.env.LITEFUSE_EVAL_DATASET];

  const configured = process.env.LITEFUSE_EVAL_DATASETS?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (configured?.length) return configured;

  return [input.ai.ASK_DOCS_EVAL_DATASET_NAME, RETRIEVAL_EVAL_DATASET_NAME];
}

function askDocsEvaluatorPreset(datasetName: string): AskDocsEvaluatorPreset {
  return datasetName.includes("retrieval") ? "rag" : "smoke";
}

interface DatasetRunSummary {
  datasetName: string;
  passed: boolean;
  itemCount: number;
  failureReason: string;
  scores: Array<{ name: string; value: number; required?: number }>;
  failedItems: Array<{ name: string; failed: number; total: number }>;
  gate?: Evaluation;
}

function summarizeDatasetRun(input: {
  datasetName: string;
  result: ExperimentResult<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>;
}): DatasetRunSummary {
  const gate = input.result.runEvaluations.find((evaluation) => evaluation.name === "regression_gate");
  const passed = gate ? gate.value === 1 : true;
  const thresholds = objectFromUnknown(gate?.metadata);
  const scores = input.result.runEvaluations
    .filter((evaluation) => evaluation.name.startsWith("average_") && typeof evaluation.value === "number")
    .map((evaluation) => {
      const name = evaluation.name.replace(/^average_/, "");
      return {
        name,
        value: evaluation.value as number,
        required: thresholdForEvaluation(thresholds, name),
      };
    });
  const evaluationNames = new Set(input.result.itemResults.flatMap((item) => item.evaluations.map((evaluation) => evaluation.name)));
  const failedItems = [...evaluationNames].flatMap((name) => {
    const required = thresholdForEvaluation(thresholds, name) ?? 1;
    const values = input.result.itemResults
      .flatMap((item) => item.evaluations)
      .filter((evaluation) => evaluation.name === name && typeof evaluation.value === "number")
      .map((evaluation) => evaluation.value as number);
    const failed = values.filter((value) => value < required).length;
    return failed > 0 ? [{ name, failed, total: values.length }] : [];
  });

  return {
    datasetName: input.datasetName,
    passed,
    itemCount: input.result.itemResults.length,
    failureReason: passed ? "passed" : gate?.comment ?? "regression gate failed",
    scores,
    failedItems,
    gate,
  };
}

function formatDatasetRunSummary(summary: DatasetRunSummary) {
  const status = formatStatus(summary.passed);
  const lines = [
    "",
    `Result: ${status} ${summary.datasetName} (${summary.itemCount} items)`,
  ];
  if (summary.scores.length > 0) {
    lines.push("Scores:");
    for (const score of summary.scores) {
      const required = score.required === undefined ? "" : `, required >= ${score.required}`;
      lines.push(`  - ${score.name}: ${score.value.toFixed(3)}${required}`);
    }
  }
  if (!summary.passed) {
    lines.push(`Failure: ${summary.failureReason}`);
    if (summary.failedItems.length > 0) {
      lines.push("Failed items:");
      for (const item of summary.failedItems) lines.push(`  - ${item.name}: ${item.failed}/${item.total}`);
    }
  }
  return lines.join("\n");
}

function formatOverallSummary(summaries: DatasetRunSummary[]) {
  const passed = summaries.filter((summary) => summary.passed).length;
  const failed = summaries.length - passed;
  const lines = ["", `Overall: ${formatStatus(failed === 0)} (${passed}/${summaries.length} datasets passed)`];
  for (const summary of summaries) {
    lines.push(`  - ${formatStatus(summary.passed)} ${summary.datasetName}: ${summary.itemCount} items`);
  }
  return lines.join("\n");
}

function formatStatus(passed: boolean) {
  return passed ? `${ANSI_GREEN}✓ PASS${ANSI_RESET}` : `${ANSI_RED}✗ FAIL${ANSI_RESET}`;
}

function thresholdForEvaluation(thresholds: Record<string, unknown>, name: string) {
  const camelName = name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = thresholds[camelName] ?? thresholds[name];
  return typeof value === "number" ? value : undefined;
}

async function runLocalExperiment(input: {
  client: ReturnType<Ai["getLitefuseClient"]>;
  file: string;
  minItems: number;
  experiment: Omit<ExperimentParams<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>, "data">;
}) {
  const data = await readLocalItems(input.file);
  if (data.length < input.minItems) {
    throw new Error(`Local eval file ${input.file} has ${data.length} items; expected at least ${input.minItems}`);
  }
  if (input.client) {
    return input.client.experiment.run({ ...input.experiment, data });
  }
  return runLocalDataExperiment({ ...input.experiment, data });
}

async function runLitefuseDatasetExperiment(input: {
  client: NonNullable<ReturnType<Ai["getLitefuseClient"]>>;
  datasetName: string;
  minItems: number;
  experiment: Omit<Parameters<NonNullable<ReturnType<Ai["getLitefuseClient"]>>["experiment"]["run"]>[0], "data">;
}) {
  const dataset = await input.client.dataset.get(input.datasetName);
  if (dataset.items.length < input.minItems) {
    throw new Error(`Dataset ${input.datasetName} has ${dataset.items.length} items; expected at least ${input.minItems}`);
  }
  return dataset.runExperiment(input.experiment);
}

async function runLocalDataExperiment(
  config: ExperimentParams<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>,
): Promise<ExperimentResult<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>> {
  const runName = config.runName ?? `${config.name} - ${new Date().toISOString()}`;
  const experimentId = crypto.randomUUID();
  const batchSize = Math.max(1, Math.floor(config.maxConcurrency ?? 50));
  const itemResults: ExperimentItemResult<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>[] = [];

  for (let index = 0; index < config.data.length; index += batchSize) {
    const batch = config.data.slice(index, index + batchSize);
    const settled = await Promise.allSettled(batch.map((item) => runLocalExperimentItem({ item, config })));
    for (const result of settled) {
      if (result.status === "fulfilled") {
        itemResults.push(result.value);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`Task failed with error: ${message}. Skipping item.`);
      }
    }
  }

  const runEvaluations = (await Promise.all((config.runEvaluators ?? []).map((runEvaluator) => runEvaluator({ itemResults })))).flat();

  return {
    experimentId,
    runName,
    itemResults,
    runEvaluations,
    format: async (options) =>
      formatLocalExperimentResult({
        name: config.name,
        runName,
        description: config.description,
        itemResults,
        originalData: config.data,
        runEvaluations,
        includeItemResults: options?.includeItemResults ?? false,
      }),
  };
}

async function runLocalExperimentItem(input: {
  item: ExperimentItem<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>;
  config: ExperimentParams<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>;
}): Promise<ExperimentItemResult<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>> {
  if (input.item.input === undefined) throw new Error("Experiment item is missing input. Skipping item.");

  const output = await input.config.task(input.item);
  const evaluations = (
    await Promise.all((input.config.evaluators ?? []).map((evaluator) => evaluator({
      input: input.item.input,
      expectedOutput: input.item.expectedOutput,
      output,
      metadata: input.item.metadata,
    })))
  ).flat();

  return {
    input: input.item.input,
    expectedOutput: input.item.expectedOutput,
    item: input.item,
    output,
    evaluations,
  };
}

function formatLocalExperimentResult(input: {
  name: string;
  runName: string;
  description?: string;
  itemResults: ExperimentItemResult<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>[];
  originalData: ExperimentItem<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>[];
  runEvaluations: Evaluation[];
  includeItemResults: boolean;
}) {
  if (input.itemResults.length === 0) return "No experiment results to display.";

  let output = "";
  if (input.includeItemResults) {
    for (let index = 0; index < input.itemResults.length; index += 1) {
      const result = input.itemResults[index];
      const originalItem = input.originalData[index];
      output += `\n${index + 1}. Item ${index + 1}:\n`;
      output += `   Input:    ${formatValue(originalItem?.input)}\n`;
      output += `   Expected: ${formatValue(originalItem?.expectedOutput ?? result.expectedOutput ?? null)}\n`;
      output += `   Actual:   ${formatValue(result.output)}\n`;
      if (result.evaluations.length > 0) {
        output += "   Scores:\n";
        for (const evaluation of result.evaluations) {
          const score = typeof evaluation.value === "number" ? evaluation.value.toFixed(3) : evaluation.value;
          output += `     - ${evaluation.name}: ${score}\n`;
          if (evaluation.comment) output += `       ${evaluation.comment}\n`;
        }
      }
    }
  } else {
    output += `Individual Results: Hidden (${input.itemResults.length} items)\n`;
    output += "Call format({ includeItemResults: true }) to view them\n";
  }

  const evaluationNames = new Set(input.itemResults.flatMap((result) => result.evaluations.map((evaluation) => evaluation.name)));
  output += `\n${"-".repeat(50)}\n`;
  output += `Experiment: ${input.name}\n`;
  output += `Run name: ${input.runName}`;
  if (input.description) output += ` - ${input.description}`;
  output += `\n${input.itemResults.length} items`;

  if (evaluationNames.size > 0) {
    output += "\nEvaluations:";
    for (const name of evaluationNames) output += `\n  - ${name}`;
    output += "\n\nAverage Scores:";
    for (const name of evaluationNames) {
      const scores = input.itemResults
        .flatMap((result) => result.evaluations)
        .filter((evaluation) => evaluation.name === name && typeof evaluation.value === "number")
        .map((evaluation) => evaluation.value as number);
      if (scores.length > 0) output += `\n  - ${name}: ${average(scores).toFixed(3)}`;
    }
    output += "\n";
  }

  if (input.runEvaluations.length > 0) {
    output += "\nRun Evaluations:";
    for (const evaluation of input.runEvaluations) {
      const score = typeof evaluation.value === "number" ? evaluation.value.toFixed(3) : evaluation.value;
      output += `\n  - ${evaluation.name}: ${score}`;
      if (evaluation.comment) output += `\n    ${evaluation.comment}`;
    }
    output += "\n";
  }

  return output;
}

async function readLocalItems(path: string): Promise<ExperimentItem<AskDocsEvalInput, AskDocsEvalExpected, AskDocsEvalMetadata>[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const object = raw && typeof raw === "object" ? (raw as { items?: unknown }) : {};
  const items = Array.isArray(raw) ? raw : Array.isArray(object.items) ? object.items : [];
  if (items.length === 0) throw new Error(`No eval items found in ${path}`);
  const { normalizeAskDocsEvalItem } = await import("../packages/ai/src/index");
  return items.map((item) => normalizeAskDocsEvalItem(item as { input?: unknown; expectedOutput?: unknown; metadata?: unknown }));
}

function createAskDocsTask(input: {
  runtime: Runtime;
  db: ReturnType<Db["createDb"]>;
  doris: ReturnType<Doris["createDorisPool"]>;
  askRepo: ReturnType<Db["createAskRepo"]>;
  defaultOrganizationId?: string;
  defaultTopK: number;
}) {
  return async (params: ExperimentTaskParams<unknown, unknown, Record<string, unknown>>): Promise<AskDocsEvalOutput> => {
    const item = input.runtime.ai.normalizeAskDocsEvalItem(params);
    const organizationId = item.input.organizationId ?? input.defaultOrganizationId;
    if (!organizationId) {
      throw new Error("Eval item organizationId, LITEFUSE_EVAL_ORGANIZATION_ID, INIT_ORGANIZATION_ID, or DEV_ORGANIZATION_ID is required");
    }

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

    for await (const event of input.runtime.ai.runAskDocsWorkflow({
      organizationId,
      question: item.input.question,
      retriever: {
        search: (searchInput) => input.runtime.doris.createChunkStore(input.doris).searchChunks(searchInput),
      },
      embeddings: input.runtime.rag.embeddingProviderFromEnv(),
      documentIds,
      topK: item.input.topK ?? input.defaultTopK,
      includeDebugChunks: true,
      agent: input.runtime.ai.mastra.agents.docAnswerAgent,
      requestRewriter: input.runtime.ai.requestRewriterFromEnv(),
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

function requiredLitefuseClient(client: ReturnType<Ai["getLitefuseClient"]>): NonNullable<ReturnType<Ai["getLitefuseClient"]>> {
  if (!client) throw new Error("LITEFUSE_PUBLIC_KEY and LITEFUSE_SECRET_KEY are required to run dataset evals");
  return client;
}

async function resolveDocumentIds(input: {
  db: ReturnType<Db["createDb"]>;
  organizationId: string;
  projectId?: string;
  documentIds?: string[];
}) {
  if (input.documentIds?.length) return input.documentIds;
  if (!input.projectId) return undefined;

  const { createDocumentsRepo, createProjectsRepo } = await import("../packages/db/src/index");
  const project = await createProjectsRepo(input.db).findById(input.organizationId, input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const documents = await createDocumentsRepo(input.db).listReadyByProject(input.organizationId, input.projectId);
  if (documents.length === 0) throw new Error(`Project has no ready documents: ${input.projectId}`);
  return documents.map((document) => document.id);
}

function defaultEvalOrganizationId() {
  return (
    process.env.LITEFUSE_EVAL_ORGANIZATION_ID?.trim() ||
    process.env.INIT_ORGANIZATION_ID?.trim() ||
    process.env.DEV_ORGANIZATION_ID?.trim() ||
    "dev-org"
  );
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

function formatValue(value: unknown) {
  if (typeof value === "string") return value.length > 50 ? `${value.substring(0, 47)}...` : value;
  return JSON.stringify(value);
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
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
