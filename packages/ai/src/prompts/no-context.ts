import type { AskAgentInput } from "@selectdb/shared";

export function buildNoContextPrompt(question: string, agent?: AskAgentInput) {
  return [
    agent?.instructions ?? "Answer from retrieved organization-scoped document context.",
    "The document retrieval step returned no relevant context.",
    "Answer briefly that there is not enough document context to answer. Do not invent citations.",
    "",
    `Question: ${question}`,
  ].join("\n");
}
