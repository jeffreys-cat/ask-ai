import { ASK_DOC_ANSWER_AGENT, type AskAgentInput } from "@selectdb/shared";
import { buildAskDocsPrompt } from "../../prompts/ask-docs";
import { buildNoContextPrompt } from "../../prompts/no-context";

export const docAnswerAgent = ASK_DOC_ANSWER_AGENT;

export function buildDocAnswerPrompt(input: {
  question: string;
  context: string;
  citations: Parameters<typeof buildAskDocsPrompt>[0]["citations"];
  agent?: AskAgentInput;
}) {
  return input.context.trim()
    ? buildAskDocsPrompt(input)
    : buildNoContextPrompt(input.question, input.agent);
}
