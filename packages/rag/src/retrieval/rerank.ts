import type { RetrievedChunk } from "@selectdb/shared";

export interface RerankResult {
  index: number;
  score: number;
}

export interface Reranker {
  provider: string;
  model: string;
  rerank(input: {
    query: string;
    chunks: RetrievedChunk[];
    topK: number;
  }): Promise<RerankResult[]>;
}

export interface RerankChunksInput {
  query: string;
  chunks: RetrievedChunk[];
  topK: number;
  reranker?: Reranker;
  failOpen?: boolean;
}

export interface RerankChunksOutput {
  chunks: RetrievedChunk[];
  usedRerank: boolean;
  fallback: boolean;
  error?: string;
}

export type RerankProviderName = "qwen" | "dashscope" | "cohere";

export interface HttpRerankerConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  instruct?: string;
  timeoutMs?: number;
  maxDocChars?: number;
}

type HttpRerankerSpec = {
  provider: RerankProviderName;
  defaultModel: string;
  defaultBaseUrl: string;
  path: string;
  buildBody: (input: { model: string; query: string; documents: string[]; topK: number; instruct?: string }) => unknown;
  readResults: (payload: unknown) => RerankResult[];
};

const DEFAULT_QWEN_RERANK_MODEL = "qwen3-rerank";
const DEFAULT_COHERE_RERANK_MODEL = "rerank-v4.0-fast";
const DEFAULT_RERANK_TIMEOUT_MS = 3000;
const DEFAULT_RERANK_MAX_DOC_CHARS = 4000;

export async function rerankChunks(input: RerankChunksInput): Promise<RerankChunksOutput> {
  const topK = normalizeTopK(input.topK);
  const fallbackChunks = fallbackRank(input.chunks, topK);
  if (!input.reranker || input.chunks.length === 0) {
    return { chunks: fallbackChunks, usedRerank: false, fallback: false };
  }

  try {
    const results = await input.reranker.rerank({
      query: input.query,
      chunks: input.chunks,
      topK,
    });
    const chunks = applyRerankResults({
      chunks: input.chunks,
      results,
      topK,
      provider: input.reranker.provider,
      model: input.reranker.model,
    });
    if (!chunks.some((chunk) => chunk.retrieval?.rerank)) {
      throw new Error("Reranker response did not include valid results");
    }
    return { chunks, usedRerank: true, fallback: false };
  } catch (error) {
    if (input.failOpen === false) throw error;
    return {
      chunks: fallbackChunks,
      usedRerank: false,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createQwenReranker(config: HttpRerankerConfig): Reranker {
  return createHttpReranker({
    config,
    spec: {
      provider: "qwen",
      defaultModel: DEFAULT_QWEN_RERANK_MODEL,
      defaultBaseUrl: "https://dashscope.aliyuncs.com",
      path: "/compatible-api/v1/reranks",
      buildBody: ({ model, query, documents, topK, instruct }) => ({
        model,
        query,
        documents,
        top_n: topK,
        ...(instruct ? { instruct } : {}),
      }),
      readResults: (payload) => readResultsFromPath(payload, ["results"]),
    },
  });
}

export function createDashScopeReranker(config: HttpRerankerConfig): Reranker {
  return createHttpReranker({
    config,
    spec: {
      provider: "dashscope",
      defaultModel: DEFAULT_QWEN_RERANK_MODEL,
      defaultBaseUrl: "https://dashscope.aliyuncs.com",
      path: "/api/v1/services/rerank/text-rerank/text-rerank",
      buildBody: ({ model, query, documents, topK }) => ({
        model,
        input: {
          query,
          documents,
        },
        parameters: {
          top_n: topK,
          return_documents: false,
        },
      }),
      readResults: (payload) => readResultsFromPath(payload, ["output", "results"]),
    },
  });
}

export function createCohereReranker(config: HttpRerankerConfig): Reranker {
  return createHttpReranker({
    config,
    spec: {
      provider: "cohere",
      defaultModel: DEFAULT_COHERE_RERANK_MODEL,
      defaultBaseUrl: "https://api.cohere.com",
      path: "/v2/rerank",
      buildBody: ({ model, query, documents, topK }) => ({
        model,
        query,
        documents,
        top_n: topK,
      }),
      readResults: (payload) => readResultsFromPath(payload, ["results"]),
    },
  });
}

function createHttpReranker(input: { config: HttpRerankerConfig; spec: HttpRerankerSpec }): Reranker {
  const { config, spec } = input;
  const model = config.model?.trim() || spec.defaultModel;
  const endpoint = `${(config.baseUrl?.trim() || spec.defaultBaseUrl).replace(/\/$/, "")}${spec.path}`;
  const timeoutMs = normalizePositiveInteger(config.timeoutMs, DEFAULT_RERANK_TIMEOUT_MS, 30_000);
  const maxDocChars = normalizePositiveInteger(config.maxDocChars, DEFAULT_RERANK_MAX_DOC_CHARS, 20_000);

  return {
    provider: spec.provider,
    model,
    async rerank(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const documents = input.chunks.map((chunk) => formatRerankDocument(chunk, maxDocChars));

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(spec.buildBody({
            model,
            query: input.query,
            documents,
            topK: normalizeTopK(input.topK),
            instruct: config.instruct,
          })),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`${spec.provider} rerank request failed: ${response.status} ${body}`);
        }

        const results = spec.readResults(await response.json());

        if (results.length === 0 && input.chunks.length > 0) {
          throw new Error(`${spec.provider} rerank response did not include results`);
        }

        return results;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function rerankerFromEnv(env = process.env): Reranker | undefined {
  const provider = (env.RERANK_PROVIDER ?? (env.RERANK_API_KEY || env.DASHSCOPE_API_KEY ? "qwen" : "none")).trim().toLowerCase();
  if (!provider || provider === "none") return undefined;
  const apiKey = env.RERANK_API_KEY ?? (provider === "qwen" ? env.DASHSCOPE_API_KEY : undefined);
  if (!apiKey) return undefined;
  const config = {
    apiKey,
    model: env.RERANK_MODEL,
    baseUrl: env.RERANK_BASE_URL,
    instruct: env.RERANK_INSTRUCT,
    timeoutMs: env.RERANK_TIMEOUT_MS === undefined ? undefined : Number(env.RERANK_TIMEOUT_MS),
    maxDocChars: env.RERANK_MAX_DOC_CHARS === undefined ? undefined : Number(env.RERANK_MAX_DOC_CHARS),
  };

  if (provider === "qwen") return createQwenReranker(config);
  if (provider === "dashscope") return createDashScopeReranker(config);
  if (provider === "cohere") return createCohereReranker(config);
  throw new Error(`Unsupported RERANK_PROVIDER: ${provider}`);
}

export function normalizeRerankCandidateK(topK: number, candidateK?: number) {
  const normalizedTopK = normalizeTopK(topK);
  if (candidateK === undefined || !Number.isFinite(candidateK)) {
    return Math.min(Math.max(normalizedTopK * 8, 50), 100);
  }
  return Math.min(Math.max(Math.trunc(candidateK), normalizedTopK), 100);
}

export function rerankFailOpenFromEnv(env = process.env) {
  return env.RERANK_FAIL_OPEN?.toLowerCase() !== "false";
}

export function rerankCandidateKFromEnv(topK: number, env = process.env) {
  return normalizeRerankCandidateK(topK, env.RERANK_CANDIDATE_K === undefined ? undefined : Number(env.RERANK_CANDIDATE_K));
}

function applyRerankResults(input: {
  chunks: RetrievedChunk[];
  results: RerankResult[];
  topK: number;
  provider: string;
  model: string;
}) {
  const byIndex = new Set<number>();
  const reranked: RetrievedChunk[] = [];

  for (const result of input.results) {
    if (reranked.length >= input.topK) break;
    if (byIndex.has(result.index)) continue;
    const chunk = input.chunks[result.index];
    if (!chunk) continue;
    byIndex.add(result.index);
    reranked.push({
      ...chunk,
      score: result.score,
      retrieval: {
        mode: "hybrid",
        matchedBy: [],
        ...chunk.retrieval,
        rerank: {
          provider: input.provider,
          model: input.model,
          score: result.score,
          rank: reranked.length + 1,
        },
      },
    });
  }

  if (reranked.length < input.topK) {
    const fallback = fallbackRank(input.chunks, input.topK).filter((chunk) => !byIndex.has(input.chunks.indexOf(chunk)));
    reranked.push(...fallback.slice(0, input.topK - reranked.length));
  }

  return reranked;
}

function fallbackRank(chunks: RetrievedChunk[], topK: number) {
  return [...chunks]
    .sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.chunkId.localeCompare(b.chunkId))
    .slice(0, topK);
}

function formatRerankDocument(chunk: RetrievedChunk, maxDocChars: number) {
  const parts = [chunk.title ? `Title: ${chunk.title}` : undefined, chunk.sourceUri ? `Source: ${chunk.sourceUri}` : undefined, chunk.content].filter(Boolean);
  return parts.join("\n").slice(0, maxDocChars);
}

function readResultsFromPath(payload: unknown, path: string[]) {
  const value = path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const object = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        index: Number(object.index),
        score: Number(object.relevance_score),
      };
    })
    .filter((item) => Number.isInteger(item.index) && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);
}

function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return 8;
  return Math.min(Math.max(Math.trunc(topK), 1), 50);
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
