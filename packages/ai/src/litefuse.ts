import { LangfuseClient } from "@langfuse/client";

export interface LitefuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  serviceName: string;
  realtime: boolean;
  environment?: string;
  release?: string;
  promptCacheTtlSeconds: number;
  promptFetchTimeoutMs: number;
}

let litefuseClient: LangfuseClient | undefined;

export function litefuseConfigFromEnv(env = process.env): LitefuseConfig | undefined {
  const publicKey = env.LITEFUSE_PUBLIC_KEY ?? env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LITEFUSE_SECRET_KEY ?? env.LANGFUSE_SECRET_KEY;
  const realtime = env.LITEFUSE_REALTIME ?? env.LANGFUSE_REALTIME;

  if (!publicKey || !secretKey) return undefined;

  return {
    publicKey,
    secretKey,
    baseUrl: env.LITEFUSE_BASE_URL ?? env.LANGFUSE_BASE_URL ?? "https://litefuse.cloud",
    serviceName: env.LITEFUSE_SERVICE_NAME ?? "ask-ai",
    realtime: realtime === undefined ? env.NODE_ENV === "development" : realtime === "true",
    environment: env.LITEFUSE_ENVIRONMENT ?? env.NODE_ENV,
    release: env.LITEFUSE_RELEASE ?? env.APP_VERSION ?? env.GIT_COMMIT,
    promptCacheTtlSeconds: numberFromEnv(env.LITEFUSE_PROMPT_CACHE_TTL_SECONDS, 300),
    promptFetchTimeoutMs: numberFromEnv(env.LITEFUSE_PROMPT_FETCH_TIMEOUT_MS, 3000),
  };
}

export const litefuseConfig = litefuseConfigFromEnv();

export function getLitefuseClient() {
  if (!litefuseConfig) return undefined;
  litefuseClient ??= new LangfuseClient({
    publicKey: litefuseConfig.publicKey,
    secretKey: litefuseConfig.secretKey,
    baseUrl: litefuseConfig.baseUrl,
    timeout: Math.ceil(litefuseConfig.promptFetchTimeoutMs / 1000),
  });
  return litefuseClient;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
