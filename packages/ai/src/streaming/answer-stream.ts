export interface ChatStreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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
): AsyncGenerator<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      if (onChunk) {
        onChunk({
          delta: payload.choices?.[0]?.delta?.content,
          usage: payload.usage,
        });
      }
      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) yield delta;
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
