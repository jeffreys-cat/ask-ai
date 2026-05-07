import { buildAskDocsPrompt } from "../../prompts/ask-docs";
import { buildNoContextPrompt } from "../../prompts/no-context";

export const docAnswerAgent = {
  name: "doc-answer-agent",
  instructions:
    "Answer from retrieved organization-scoped document context. Be concise and cite sources with bracketed citation numbers.",
};

export function buildDocAnswerPrompt(input: { question: string; context: string; citations: Parameters<typeof buildAskDocsPrompt>[0]["citations"] }) {
  return input.context.trim()
    ? buildAskDocsPrompt(input)
    : buildNoContextPrompt(input.question);
}
