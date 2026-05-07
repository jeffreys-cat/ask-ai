import { BadRequestError } from "@selectdb/shared";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

export function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function createOpenAICompatibleEmbeddingProvider(config: OpenAICompatibleEmbeddingConfig): EmbeddingProvider {
  return {
    async embed(texts: string[]) {
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
        throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
      }

      const payload = (await response.json()) as { data: Array<{ embedding: number[] }> };
      const embeddings = payload.data.map((item) => validateEmbeddingDimensions(normalizeVector(item.embedding), config.dimensions));
      if (embeddings.length !== texts.length) {
        throw new Error(`Embedding response count mismatch: expected ${texts.length}, got ${embeddings.length}`);
      }
      return embeddings;
    },
  };
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

  if (!apiKey || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("OPENAI_API_KEY, EMBEDDING_MODEL and EMBEDDING_DIM are required");
  }

  return createOpenAICompatibleEmbeddingProvider({ baseUrl, apiKey, model, dimensions });
}
