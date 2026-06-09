export interface ChatStreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  includeUsageInStream?: boolean;
}

export interface ChatStreamTelemetry {
  onRequestStarted?: () => void;
  onResponseHeaders?: (event: { latencyMs: number; status: number; contentType: string | null }) => void;
  onFirstPayload?: (event: { latencyMs: number; hasDelta: boolean; hasUsage: boolean }) => void;
  onFirstDelta?: (event: { latencyMs: number; deltaLength: number }) => void;
  onUsage?: (event: { latencyMs: number; usage: ChatUsage }) => void;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export interface ChatUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
  [key: string]: number | undefined;
}

export type StreamChunk = {
  delta?: string;
  usage?: ChatUsage;
};

export function chatConfigFromEnv(env = process.env): ChatStreamConfig {
  const apiKey = env.CHAT_API_KEY ?? env.OPENAI_API_KEY;
  const model = env.CHAT_MODEL;
  if (!apiKey || !model) {
    throw new Error("CHAT_API_KEY or OPENAI_API_KEY, and CHAT_MODEL are required");
  }
  return {
    baseUrl: env.CHAT_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model,
    includeUsageInStream: env.CHAT_STREAM_INCLUDE_USAGE ? env.CHAT_STREAM_INCLUDE_USAGE.toLowerCase() === "true" : true,
  };
}

export async function* streamOpenAICompatibleAnswer(
  config: ChatStreamConfig,
  prompt: string,
): AsyncGenerator<string> {
  yield* streamOpenAICompatibleChat(config, [{ role: "user", content: prompt }]);
}

export async function* streamOpenAICompatibleChat(
  config: ChatStreamConfig,
  messages: ChatMessage[],
  onChunk?: (chunk: StreamChunk) => void,
  telemetry?: ChatStreamTelemetry,
): AsyncGenerator<string> {
  const includeUsageInStream = config.includeUsageInStream !== false;
  const requestStartedAt = performance.now();
  telemetry?.onRequestStarted?.();
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      stream_options: includeUsageInStream ? { include_usage: true } : undefined,
      messages,
    }),
  });

  telemetry?.onResponseHeaders?.({
    latencyMs: elapsed(requestStartedAt),
    status: response.status,
    contentType: response.headers.get("content-type"),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawFirstPayload = false;
  let sawFirstDelta = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; usage?: ChatUsage };
      if (!sawFirstPayload) {
        sawFirstPayload = true;
        telemetry?.onFirstPayload?.({
          latencyMs: elapsed(requestStartedAt),
          hasDelta: Boolean(payload.choices?.[0]?.delta?.content),
          hasUsage: Boolean(payload.usage),
        });
      }
      if (onChunk) {
        onChunk({ delta: payload.choices?.[0]?.delta?.content, usage: payload.usage });
      }
      if (payload.usage) {
        telemetry?.onUsage?.({
          latencyMs: elapsed(requestStartedAt),
          usage: payload.usage,
        });
      }
      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) yield delta;
      if (delta && !sawFirstDelta) {
        sawFirstDelta = true;
        telemetry?.onFirstDelta?.({
          latencyMs: elapsed(requestStartedAt),
          deltaLength: delta.length,
        });
      }
    }
  }
}

export async function completeOpenAICompatibleChat(config: ChatStreamConfig, messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}
