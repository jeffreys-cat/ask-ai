import type { AskAgentInput } from "@selectdb/shared";

export function buildNoContextPrompt(question: string, agent?: AskAgentInput) {
  return [
    agent?.instructions ?? "Answer only from retrieved document context. If none exists, say so. Do not guess.",
    "No relevant context was retrieved.",
    "Answer briefly that there is not enough document context.",
    `Question: ${question}`,
  ].join("\n");
}
