import { chatConfigFromEnv, completeOpenAICompatibleChat, type ChatStreamConfig } from "../streaming/answer-stream";

export interface RequestRewriter {
  provider: string;
  model: string;
  rewrite(input: { question: string }): Promise<string>;
}

const SYSTEM_PROMPT = [
  "Rewrite the user's question into a concise, standalone search query for documentation retrieval.",
  "Preserve product names, API names, configuration keys, error codes, version constraints, and the user's language.",
  "Do not answer the question. Return only the rewritten search query.",
  "If the question is already clear and standalone, return it unchanged.",
].join(" ");

export function createOpenAICompatibleRequestRewriter(config: ChatStreamConfig): RequestRewriter {
  return {
    provider: providerFromBaseUrl(config.baseUrl),
    model: config.model,
    async rewrite(input) {
      const content = await completeOpenAICompatibleChat(config, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.question },
      ]);
      return normalizeRewrittenQuery(content, input.question);
    },
  };
}

export function requestRewriterFromEnv(env = process.env): RequestRewriter | undefined {
  if (env.QUERY_REWRITE_ENABLED?.toLowerCase() !== "true") return undefined;
  const chatConfig = chatConfigFromEnv(env);
  return createOpenAICompatibleRequestRewriter({
    ...chatConfig,
    model: env.QUERY_REWRITE_MODEL?.trim() || chatConfig.model,
  });
}

export function queryRewriteFailOpenFromEnv(env = process.env) {
  return env.QUERY_REWRITE_FAIL_OPEN?.toLowerCase() !== "false";
}

function normalizeRewrittenQuery(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function providerFromBaseUrl(baseUrl: string) {
  try {
    const host = new URL(baseUrl).host;
    if (host.includes("openai.com")) return "openai";
    return host;
  } catch {
    return "openai-compatible";
  }
}
