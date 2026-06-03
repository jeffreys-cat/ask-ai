import type { Evaluation, Evaluator, RunEvaluator } from "@langfuse/client";
import type { Citation, JsonObject, RetrievedChunk } from "@selectdb/shared";

export const ASK_DOCS_EVAL_DATASET_NAME = "ask-ai-docs-eval";

export const DEFAULT_ASK_DOCS_EVAL_THRESHOLDS = {
  languageConsistency: 1,
};

export const RAG_ASK_DOCS_EVAL_THRESHOLDS = {
  languageConsistency: 1,
  retrievalRecall: 1,
  citationCorrectness: 0.8,
  groundedness: 0.8,
  answerHelpfulness: 0.8,
  refusalCorrectness: 1,
};

export interface AskDocsEvalInput {
  question: string;
  projectId?: string;
  organizationId?: string;
  documentIds?: string[];
  topK?: number;
  tags?: string[];
}

export interface AskDocsEvalExpected {
  expectedAnswer?: string;
  expectedCitationDocIds?: string[];
  shouldRefuse?: boolean;
  mustInclude?: string[];
}

export interface AskDocsEvalMetadata extends JsonObject {
  tags?: string[];
  critical?: boolean;
}

export interface AskDocsEvalOutput {
  answer: string;
  citations: Citation[];
  retrievedChunks: RetrievedChunk[];
  latencyMs?: number;
  error?: string;
}

export type AskDocsEvalThresholds = typeof RAG_ASK_DOCS_EVAL_THRESHOLDS;

export type AskDocsEvaluatorPreset = "smoke" | "rag";

export interface NormalizedAskDocsEvalItem {
  input: AskDocsEvalInput;
  expectedOutput: AskDocsEvalExpected;
  metadata: AskDocsEvalMetadata;
}

export function normalizeAskDocsEvalItem(item: {
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
}): NormalizedAskDocsEvalItem {
  const input = objectFromUnknown(item.input);
  const expected = objectFromUnknown(item.expectedOutput);
  const metadata = objectFromUnknown(item.metadata);
  const question = stringFrom(input.question) ?? stringFrom(item.input);

  if (!question) {
    throw new Error("Ask docs eval item input.question is required");
  }

  const tags = stringArrayFrom(input.tags) ?? stringArrayFrom(metadata.tags);

  return {
    input: {
      question,
      projectId: stringFrom(input.projectId) ?? stringFrom(metadata.projectId),
      organizationId: stringFrom(input.organizationId) ?? stringFrom(metadata.organizationId),
      documentIds: stringArrayFrom(input.documentIds),
      topK: numberFrom(input.topK),
      tags,
    },
    expectedOutput: {
      expectedAnswer: stringFrom(expected.expectedAnswer) ?? stringFrom(expected.answer) ?? stringFrom(item.expectedOutput),
      expectedCitationDocIds:
        stringArrayFrom(expected.expectedCitationDocIds) ??
        stringArrayFrom(expected.citationDocIds) ??
        stringArrayFrom(expected.expectedDocumentIds),
      shouldRefuse: booleanFrom(expected.shouldRefuse) ?? tags?.includes("no-context") ?? tags?.includes("unanswerable"),
      mustInclude: stringArrayFrom(expected.mustInclude),
    },
    metadata: removeUndefined({
      ...metadata,
      tags,
      critical: booleanFrom(metadata.critical),
    }),
  };
}

export function createAskDocsEvaluators(preset: AskDocsEvaluatorPreset = "smoke"): Evaluator<unknown, unknown, Record<string, unknown>>[] {
  const evaluators = [async (params: { input: unknown; expectedOutput?: unknown; output: unknown; metadata?: unknown }) => scoreLanguageConsistency(normalizeParams(params))];
  if (preset === "smoke") return evaluators;

  return [
    ...evaluators,
    async (params) => scoreRetrievalRecall(normalizeParams(params)),
    async (params) => scoreCitationCorrectness(normalizeParams(params)),
    async (params) => scoreGroundedness(normalizeParams(params)),
    async (params) => scoreAnswerHelpfulness(normalizeParams(params)),
    async (params) => scoreRefusalCorrectness(normalizeParams(params)),
  ];
}

export function createAskDocsRunEvaluators(
  thresholds: Partial<AskDocsEvalThresholds> = DEFAULT_ASK_DOCS_EVAL_THRESHOLDS,
): RunEvaluator<unknown, unknown, Record<string, unknown>>[] {
  const resolved = thresholds;
  return [
    async ({ itemResults }) => {
      const averages = averageEvaluations(itemResults.flatMap((item) => item.evaluations));
      const failures = Object.entries(resolved).flatMap(([thresholdName, threshold]) => {
        const evaluationName = snakeCase(thresholdName);
        const actual = averages.get(evaluationName) ?? 0;
        return actual >= threshold ? [] : [{ evaluationName, actual, threshold }];
      });
      const pass = failures.length === 0;
      const thresholdDiagnostics = Object.entries(resolved).flatMap(([thresholdName, threshold]) => {
        const evaluationName = snakeCase(thresholdName);
        const values = itemResults
          .flatMap((item) => item.evaluations)
          .filter((evaluation) => evaluation.name === evaluationName && typeof evaluation.value === "number")
          .map((evaluation) => evaluation.value as number);
        if (values.length === 0) return [];

        const failedCount = values.filter((value) => value < threshold).length;
        const passRate = (values.length - failedCount) / values.length;
        return [
          {
            name: `failed_${evaluationName}`,
            value: failedCount,
            comment: `${failedCount}/${values.length} items failed ${evaluationName} threshold ${threshold}.`,
          },
          {
            name: `pass_rate_${evaluationName}`,
            value: passRate,
            comment: `${values.length - failedCount}/${values.length} items passed ${evaluationName} threshold ${threshold}.`,
          },
        ];
      });

      return [
        ...[...averages.entries()].map(([name, value]) => ({
          name: `average_${name}`,
          value,
          comment: `Average ${name} across ${itemResults.length} eval items.`,
        })),
        ...thresholdDiagnostics,
        {
          name: "regression_gate",
          value: pass ? 1 : 0,
          comment: pass
            ? "All default regression thresholds passed."
            : `Thresholds failed: ${failures
                .map((failure) => `${failure.evaluationName} actual ${failure.actual.toFixed(3)} < required ${failure.threshold}`)
                .join("; ")}.`,
          metadata: resolved,
        },
      ];
    },
  ];
}

export function scoreLanguageConsistency(params: NormalizedEvalParams): Evaluation {
  if (params.output.error) return score("language_consistency", 0, params.output.error);
  if (!params.output.answer.trim()) return score("language_consistency", 0, "No answer was produced.");

  const inputLanguage = detectPrimaryLanguage(params.input.question);
  const outputLanguage = detectPrimaryLanguage(params.output.answer);
  if (inputLanguage === "unknown") {
    return {
      name: "language_consistency",
      value: 1,
      comment: "Input language could not be determined; language consistency was not enforced.",
      metadata: { inputLanguage, outputLanguage },
    };
  }
  if (outputLanguage === "unknown") {
    return {
      name: "language_consistency",
      value: 0,
      comment: "Output language could not be determined.",
      metadata: { inputLanguage, outputLanguage },
    };
  }

  return {
    name: "language_consistency",
    value: inputLanguage === outputLanguage ? 1 : 0,
    comment:
      inputLanguage === outputLanguage
        ? `Output language matches input language: ${inputLanguage}.`
        : `Output language ${outputLanguage} does not match input language ${inputLanguage}.`,
    metadata: { inputLanguage, outputLanguage },
  };
}

export function scoreRetrievalRecall(params: NormalizedEvalParams): Evaluation {
  const expectedDocIds = params.expected.expectedCitationDocIds ?? [];
  if (expectedDocIds.length === 0) {
    return {
      name: "retrieval_recall",
      value: 1,
      comment: "No expected citation documents were provided.",
    };
  }

  const foundDocIds = new Set([
    ...params.output.citations.map((citation) => citation.documentId),
    ...params.output.retrievedChunks.map((chunk) => chunk.documentId),
  ]);
  const matched = expectedDocIds.filter((documentId) => foundDocIds.has(documentId));
  return {
    name: "retrieval_recall",
    value: matched.length / expectedDocIds.length,
    comment: `Matched ${matched.length}/${expectedDocIds.length} expected document ids.`,
    metadata: { expectedDocIds, matchedDocIds: matched },
  };
}

export function scoreGroundedness(params: NormalizedEvalParams): Evaluation {
  if (params.output.error) return score("groundedness", 0, params.output.error);
  if (!params.output.answer.trim()) return score("groundedness", 0, "No answer was produced.");
  if (params.expected.shouldRefuse) {
    return score("groundedness", hasRefusalLanguage(params.output.answer) ? 1 : 0, "Refusal item is grounded when the answer refuses.");
  }

  const citationMarkers = citationMarkerNumbers(params.output.answer);
  const invalidMarkers = citationMarkers.filter((id) => id < 1 || id > params.output.citations.length);
  if (invalidMarkers.length > 0) {
    return score("groundedness", 0.25, `Answer references missing citation ids: ${invalidMarkers.join(", ")}.`);
  }
  if (params.output.citations.length === 0 && params.output.retrievedChunks.length === 0) {
    return score("groundedness", 0, "Answer was produced without retrieved context.");
  }
  if (citationMarkers.length === 0) {
    return score("groundedness", 0.5, "Answer has retrieved context but no inline citation markers.");
  }
  return score("groundedness", 1, "Answer uses valid inline citation markers.");
}

export function scoreCitationCorrectness(params: NormalizedEvalParams): Evaluation {
  if (params.output.error) return score("citation_correctness", 0, params.output.error);

  const markerNumbers = citationMarkerNumbers(params.output.answer);
  const invalidMarkers = markerNumbers.filter((id) => id < 1 || id > params.output.citations.length);
  if (invalidMarkers.length > 0) {
    return score("citation_correctness", 0, `Answer references missing citation ids: ${invalidMarkers.join(", ")}.`);
  }

  const expectedDocIds = params.expected.expectedCitationDocIds ?? [];
  if (expectedDocIds.length === 0) {
    const value = params.expected.shouldRefuse ? (markerNumbers.length === 0 ? 1 : 0) : 1;
    return score("citation_correctness", value, "No expected citation documents were provided.");
  }
  if (markerNumbers.length === 0) {
    return score("citation_correctness", 0, "Expected cited answer, but no inline citation markers were produced.");
  }

  const expected = new Set(expectedDocIds);
  const citedDocIds = markerNumbers
    .map((id) => params.output.citations[id - 1]?.documentId)
    .filter((documentId): documentId is string => Boolean(documentId));
  const supported = citedDocIds.filter((documentId) => expected.has(documentId));
  const unsupported = citedDocIds.filter((documentId) => !expected.has(documentId));
  const missed = expectedDocIds.filter((documentId) => !supported.includes(documentId));
  return {
    name: "citation_correctness",
    value: supported.length / citedDocIds.length,
    comment: [
      `Supported ${supported.length}/${citedDocIds.length} cited document ids.`,
      `Expected: ${expectedDocIds.join(", ")}.`,
      unsupported.length > 0 ? `Unsupported cited: ${unsupported.join(", ")}.` : undefined,
      missed.length > 0 ? `Expected but not cited: ${missed.join(", ")}.` : undefined,
    ].filter(Boolean).join(" "),
    metadata: { expectedDocIds, citedDocIds, supportedDocIds: supported, unsupportedDocIds: unsupported, missedDocIds: missed },
  };
}

export function scoreAnswerHelpfulness(params: NormalizedEvalParams): Evaluation {
  if (params.output.error) return score("answer_helpfulness", 0, params.output.error);
  if (params.expected.shouldRefuse) {
    return score("answer_helpfulness", hasRefusalLanguage(params.output.answer) ? 1 : 0, "Refusal expected.");
  }

  const expectedAnswer = params.expected.expectedAnswer?.trim();
  const mustInclude = params.expected.mustInclude ?? [];
  const includeScore =
    mustInclude.length === 0
      ? undefined
      : mustInclude.filter((term) => params.output.answer.toLowerCase().includes(term.toLowerCase())).length / mustInclude.length;
  const similarityScore = expectedAnswer ? tokenF1(params.output.answer, expectedAnswer) : undefined;

  if (includeScore === undefined && similarityScore === undefined) {
    return score("answer_helpfulness", 0.5, "No expected answer or mustInclude terms were provided.");
  }

  const scores = [includeScore, similarityScore].filter((value): value is number => value !== undefined);
  return {
    name: "answer_helpfulness",
    value: average(scores),
    comment: `Deterministic helpfulness proxy from expected answer overlap and required terms.`,
    metadata: { includeScore, similarityScore, mustInclude },
  };
}

export function scoreRefusalCorrectness(params: NormalizedEvalParams): Evaluation {
  if (params.output.error) return score("refusal_correctness", 0, params.output.error);

  const refused = hasRefusalLanguage(params.output.answer);
  const hasCitations = params.output.citations.length > 0 || citationMarkerNumbers(params.output.answer).length > 0;
  if (params.expected.shouldRefuse) {
    return score("refusal_correctness", refused && !hasCitations ? 1 : 0, "Expected a no-context refusal without citations.");
  }
  return score("refusal_correctness", refused ? 0 : 1, "Expected an answer rather than a no-context refusal.");
}

function normalizeParams(params: { input: unknown; expectedOutput?: unknown; output: unknown; metadata?: unknown }): NormalizedEvalParams {
  const item = normalizeAskDocsEvalItem({
    input: params.input,
    expectedOutput: params.expectedOutput,
    metadata: params.metadata,
  });
  return {
    input: item.input,
    expected: item.expectedOutput,
    metadata: item.metadata,
    output: normalizeOutput(params.output),
  };
}

function normalizeOutput(output: unknown): AskDocsEvalOutput {
  const object = objectFromUnknown(output);
  return {
    answer: stringFrom(object.answer) ?? "",
    citations: Array.isArray(object.citations) ? (object.citations as Citation[]) : [],
    retrievedChunks: Array.isArray(object.retrievedChunks) ? (object.retrievedChunks as RetrievedChunk[]) : [],
    latencyMs: numberFrom(object.latencyMs),
    error: stringFrom(object.error),
  };
}

function citationMarkerNumbers(answer: string) {
  return [...answer.matchAll(/\[(\d+)]/g)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value));
}

function hasRefusalLanguage(answer: string) {
  const normalized = answer.toLowerCase();
  return (
    normalized.includes("not enough") ||
    normalized.includes("insufficient") ||
    normalized.includes("cannot answer") ||
    normalized.includes("can't answer") ||
    normalized.includes("do not have enough") ||
    normalized.includes("没有足够") ||
    normalized.includes("无法回答")
  );
}

function detectPrimaryLanguage(value: string): "zh" | "en" | "unknown" {
  const hanCount = [...value.matchAll(/\p{Script=Han}/gu)].length;
  if (hanCount > 0) return "zh";

  const latinWordCount = value.match(/\b[A-Za-z][A-Za-z'-]*\b/g)?.length ?? 0;
  if (latinWordCount > 0) return "en";

  return "unknown";
}

function tokenF1(actual: string, expected: string) {
  const actualTokens = tokenize(actual);
  const expectedTokens = tokenize(expected);
  if (actualTokens.length === 0 || expectedTokens.length === 0) return 0;

  const actualCounts = counts(actualTokens);
  const expectedCounts = counts(expectedTokens);
  let overlap = 0;
  for (const [token, expectedCount] of expectedCounts) {
    overlap += Math.min(actualCounts.get(token) ?? 0, expectedCount);
  }

  if (overlap === 0) return 0;
  const precision = overlap / actualTokens.length;
  const recall = overlap / expectedTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function counts(tokens: string[]) {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function averageEvaluations(evaluations: Evaluation[]) {
  const grouped = new Map<string, number[]>();
  for (const evaluation of evaluations) {
    if (typeof evaluation.value !== "number") continue;
    const values = grouped.get(evaluation.name) ?? [];
    values.push(evaluation.value);
    grouped.set(evaluation.name, values);
  }
  return new Map([...grouped.entries()].map(([name, values]) => [name, average(values)]));
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function snakeCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function score(name: string, value: number, comment: string): Evaluation {
  return { name, value, comment };
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayFrom(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => stringFrom(item)).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFrom(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export interface NormalizedEvalParams {
  input: AskDocsEvalInput;
  expected: AskDocsEvalExpected;
  metadata: AskDocsEvalMetadata;
  output: AskDocsEvalOutput;
}

function removeUndefined(input: Record<string, unknown>): AskDocsEvalMetadata {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as AskDocsEvalMetadata;
}
