import { Mastra } from "@mastra/core";
import { SpanType } from "@mastra/core/observability";
import { LangfuseExporter } from "@mastra/langfuse";
import { Observability } from "@mastra/observability";
import { docAnswerAgent } from "./agents/doc-answer.agent";

export interface LitefuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  serviceName: string;
  realtime: boolean;
  environment?: string;
  release?: string;
}

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
  };
}

export const litefuseConfig = litefuseConfigFromEnv();

const mastraInstance = new Mastra({
  environment: litefuseConfig?.environment,
  observability: litefuseConfig
    ? new Observability({
        configs: {
          litefuse: {
            serviceName: litefuseConfig.serviceName,
            exporters: [
              new LangfuseExporter({
                publicKey: litefuseConfig.publicKey,
                secretKey: litefuseConfig.secretKey,
                baseUrl: litefuseConfig.baseUrl,
                realtime: litefuseConfig.realtime,
                environment: litefuseConfig.environment,
                release: litefuseConfig.release,
              }),
            ],
            excludeSpanTypes: [SpanType.MODEL_CHUNK],
          },
        },
      })
    : undefined,
});

export const mastra = Object.assign(mastraInstance, {
  agents: {
    docAnswerAgent,
  },
});
