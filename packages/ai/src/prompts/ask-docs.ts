import type { AskAgentInput, Citation } from "@selectdb/shared";

export function buildAskDocsPrompt(input: { question: string; context: string; citations: Citation[]; agent?: AskAgentInput }) {
  return [
    input.agent?.instructions ?? "Answer only from the provided context. If it is insufficient, say so. Do not guess. Cite as [1].",
    `Question: ${input.question}`,
    `Context: ${input.context}`,
  ].join("\n");
}
