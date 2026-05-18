import { Mastra } from "@mastra/core";
import { SpanType } from "@mastra/core/observability";
import { LangfuseExporter } from "@mastra/langfuse";
import { Observability } from "@mastra/observability";
import { litefuseConfig } from "../litefuse";
import { docAnswerAgent } from "./agents/doc-answer.agent";
export { getLitefuseClient, litefuseConfig, litefuseConfigFromEnv } from "../litefuse";

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
