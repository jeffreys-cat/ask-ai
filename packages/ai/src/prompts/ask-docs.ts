import type { AskAgentInput, Citation } from "@selectdb/shared";

export function buildAskDocsPrompt(input: { question: string; context: string; citations: Citation[]; agent?: AskAgentInput }) {
  return [
    input.agent?.instructions ?? "You answer questions using only the provided document context.",
    "If the context is insufficient, say you do not have enough information.",
    "Cite supporting sources inline using bracket numbers like [1].",
    "",
    `Question: ${input.question}`,
    "",
    `Context:\n${input.context}`,
  ].join("\n");
}
