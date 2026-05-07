import type { Citation } from "@selectdb/shared";

export function buildAskDocsPrompt(input: { question: string; context: string; citations: Citation[] }) {
  return [
    "You answer questions using only the provided document context.",
    "If the context is insufficient, say you do not have enough information.",
    "Cite supporting sources inline using bracket numbers like [1].",
    "",
    `Question: ${input.question}`,
    "",
    `Context:\n${input.context}`,
  ].join("\n");
}
