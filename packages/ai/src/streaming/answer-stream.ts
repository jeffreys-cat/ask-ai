export interface ChatStreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function chatConfigFromEnv(env = process.env): ChatStreamConfig {
  const apiKey = env.OPENAI_API_KEY;
  const model = env.CHAT_MODEL;
  if (!apiKey || !model) {
    throw new Error("OPENAI_API_KEY and CHAT_MODEL are required");
  }
  return {
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model,
  };
}

export async function* streamOpenAICompatibleAnswer(config: ChatStreamConfig, prompt: string): AsyncGenerator<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [{ role: "user", content: prompt }],
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
      const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
