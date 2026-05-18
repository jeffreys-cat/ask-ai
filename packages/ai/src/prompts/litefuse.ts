import { getLitefuseClient, litefuseConfig } from "../litefuse";
import type { ChatMessage } from "../streaming/answer-stream";

export interface LitefusePromptMetadata {
  name: string;
  version: number;
}

export interface LitefusePromptRenderResult {
  prompt: string;
  messages: ChatMessage[];
  litefusePrompt?: LitefusePromptMetadata;
}

export async function renderLitefuseChatPrompt(input: {
  name: string;
  fallbackMessages: ChatMessage[];
  variables: Record<string, string>;
  env?: NodeJS.ProcessEnv;
}): Promise<LitefusePromptRenderResult> {
  const client = getLitefuseClient();
  if (!client || !litefuseConfig) return resultFromMessages(input.fallbackMessages);

  const prompt = await client.prompt.get(input.name, {
    type: "chat",
    label: input.env?.LITEFUSE_PROMPT_LABEL ?? process.env.LITEFUSE_PROMPT_LABEL,
    version: numberFromEnv(input.env?.LITEFUSE_PROMPT_VERSION ?? process.env.LITEFUSE_PROMPT_VERSION),
    cacheTtlSeconds: litefuseConfig.promptCacheTtlSeconds,
    fetchTimeoutMs: litefuseConfig.promptFetchTimeoutMs,
    fallback: input.fallbackMessages,
    maxRetries: 1,
  });
  const messages = normalizeChatMessages(prompt.compile(input.variables));

  return {
    prompt: promptToString(messages),
    messages,
    litefusePrompt: prompt.isFallback ? undefined : { name: prompt.name, version: prompt.version },
  };
}

export async function renderLitefuseTextPrompt(input: {
  name: string;
  fallback: string;
  variables: Record<string, string>;
  env?: NodeJS.ProcessEnv;
}): Promise<LitefusePromptRenderResult> {
  const client = getLitefuseClient();
  if (!client || !litefuseConfig) return resultFromPrompt(input.fallback);

  const prompt = await client.prompt.get(input.name, {
    type: "text",
    label: input.env?.LITEFUSE_PROMPT_LABEL ?? process.env.LITEFUSE_PROMPT_LABEL,
    version: numberFromEnv(input.env?.LITEFUSE_PROMPT_VERSION ?? process.env.LITEFUSE_PROMPT_VERSION),
    cacheTtlSeconds: litefuseConfig.promptCacheTtlSeconds,
    fetchTimeoutMs: litefuseConfig.promptFetchTimeoutMs,
    fallback: input.fallback,
    maxRetries: 1,
  });
  const compiled = prompt.compile(input.variables);

  return {
    prompt: compiled,
    messages: [{ role: "user", content: compiled }],
    litefusePrompt: prompt.isFallback ? undefined : { name: prompt.name, version: prompt.version },
  };
}

export function litefusePromptNamesFromEnv(env = process.env) {
  return {
    docAnswer: env.LITEFUSE_DOC_ANSWER_PROMPT ?? "ask-ai-doc-answer",
    noContext: env.LITEFUSE_NO_CONTEXT_PROMPT ?? "ask-ai-no-context",
  };
}

export function resultFromPrompt(prompt: string): LitefusePromptRenderResult {
  return {
    prompt,
    messages: [{ role: "user", content: prompt }],
  };
}

export function resultFromMessages(messages: ChatMessage[]): LitefusePromptRenderResult {
  return {
    prompt: promptToString(messages),
    messages,
  };
}

function normalizeChatMessages(messages: unknown[]): ChatMessage[] {
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return undefined;
      const item = message as { role?: unknown; content?: unknown };
      if (typeof item.role !== "string" || typeof item.content !== "string") return undefined;
      return { role: normalizeRole(item.role), content: item.content };
    })
    .filter((message): message is ChatMessage => Boolean(message));
}

function normalizeRole(role: string): ChatMessage["role"] {
  if (role === "system" || role === "assistant" || role === "tool") return role;
  return "user";
}

function promptToString(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

function numberFromEnv(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
