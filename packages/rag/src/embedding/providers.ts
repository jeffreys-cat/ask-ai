import { BadRequestError } from "@selectdb/shared";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize?: number;
  maxRetries?: number;
}

export function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function createOpenAICompatibleEmbeddingProvider(config: OpenAICompatibleEmbeddingConfig): EmbeddingProvider {
  const batchSize = normalizeBatchSize(config.batchSize);

  return {
    async embed(texts: string[]) {
      if (texts.length === 0) return [];

      const embeddings: number[][] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        embeddings.push(...(await embedBatch(config, batch)));
      }

      if (embeddings.length !== texts.length) {
        throw new Error(`Embedding response count mismatch: expected ${texts.length}, got ${embeddings.length}`);
      }
      return embeddings;
    },
  };
}

async function embedBatch(config: OpenAICompatibleEmbeddingConfig, texts: string[]) {
  const maxRetries = normalizeRetryCount(config.maxRetries);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
          dimensions: config.dimensions,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`Embedding request failed: ${response.status} ${body}`);
        if (!isRetryableEmbeddingStatus(response.status) || attempt >= maxRetries) throw error;
        await waitBeforeRetry(attempt);
        continue;
      }

      const payload = (await response.json()) as { data: Array<{ embedding: number[] }> };
      const embeddings = payload.data.map((item) => validateEmbeddingDimensions(normalizeVector(item.embedding), config.dimensions));
      if (embeddings.length !== texts.length) {
        throw new Error(`Embedding response count mismatch: expected ${texts.length}, got ${embeddings.length}`);
      }
      return embeddings;
    } catch (error) {
      if (!isRetryableEmbeddingError(error) || attempt >= maxRetries) throw error;
      await waitBeforeRetry(attempt);
    }
  }

  throw new Error("Embedding request failed after retries");
}

function normalizeBatchSize(batchSize?: number) {
  if (batchSize === undefined) return 10;
  if (!Number.isFinite(batchSize)) return 10;
  return Math.min(Math.max(Math.trunc(batchSize), 1), 2048);
}

function normalizeRetryCount(maxRetries?: number) {
  if (maxRetries === undefined) return 2;
  if (!Number.isFinite(maxRetries)) return 2;
  return Math.min(Math.max(Math.trunc(maxRetries), 0), 10);
}

function isRetryableEmbeddingStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableEmbeddingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /connection|socket|network|timeout|timed out|ECONNRESET|ETIMEDOUT|EPIPE|fetch failed/i.test(message);
}

function waitBeforeRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000)));
}

export function validateEmbeddingDimensions(embedding: number[], dimensions: number) {
  if (embedding.length !== dimensions) {
    throw new BadRequestError(`Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`);
  }
  return embedding;
}

export function embeddingProviderFromEnv(env = process.env) {
  const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = env.OPENAI_API_KEY;
  const model = env.EMBEDDING_MODEL;
  const dimensions = Number(env.EMBEDDING_DIM);
  const batchSize = env.EMBEDDING_BATCH_SIZE === undefined ? undefined : Number(env.EMBEDDING_BATCH_SIZE);
  const maxRetries = env.EMBEDDING_MAX_RETRIES === undefined ? undefined : Number(env.EMBEDDING_MAX_RETRIES);

  if (!apiKey || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("OPENAI_API_KEY, EMBEDDING_MODEL and EMBEDDING_DIM are required");
  }

  return createOpenAICompatibleEmbeddingProvider({ baseUrl, apiKey, model, dimensions, batchSize, maxRetries });
}
