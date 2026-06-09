import { ASK_DOC_ANSWER_AGENT, type AskAgentInput } from "@selectdb/shared";
import { buildAskDocsPrompt } from "../../prompts/ask-docs";
import {
  litefusePromptNamesFromEnv,
  renderLitefuseChatPrompt,
  renderLitefuseTextPrompt,
  resultFromMessages,
  type LitefusePromptMetadata,
} from "../../prompts/litefuse";
import { buildNoContextPrompt } from "../../prompts/no-context";
import type { ChatMessage } from "../../streaming/answer-stream";

export const docAnswerAgent = ASK_DOC_ANSWER_AGENT;

export async function buildDocAnswerPrompt(input: {
  question: string;
  context: string;
  citations: Parameters<typeof buildAskDocsPrompt>[0]["citations"];
  agent?: AskAgentInput;
}): Promise<{ prompt: string; litefusePrompt?: LitefusePromptMetadata }> {
  const result = await buildDocAnswerMessages(input);
  return { prompt: result.prompt, litefusePrompt: result.litefusePrompt };
}

export async function buildDocAnswerMessages(input: {
  question: string;
  context: string;
  citations: Parameters<typeof buildAskDocsPrompt>[0]["citations"];
  agent?: AskAgentInput;
}): Promise<{ prompt: string; messages: ChatMessage[]; litefusePrompt?: LitefusePromptMetadata }> {
  const promptNames = litefusePromptNamesFromEnv();
  const hasContext = Boolean(input.context.trim());
  const instructions =
    input.agent?.instructions ??
    (hasContext
      ? "Answer only from the provided context. If it is insufficient, say so. Do not guess. Cite as [1]."
      : "Answer only from retrieved document context. If none exists, say so. Do not guess.");
  const fallback = hasContext ? buildAskDocsPrompt(input) : buildNoContextPrompt(input.question, input.agent);
  const fallbackMessages = hasContext ? docAnswerFallbackMessages({ ...input, instructions }) : noContextFallbackMessages(input.question, instructions);

  try {
    return await renderLitefuseChatPrompt({
      name: hasContext ? promptNames.docAnswer : promptNames.noContext,
      fallbackMessages,
      variables: {
        instructions,
        question: input.question,
        context: input.context,
        citations: JSON.stringify(input.citations),
      },
    });
  } catch (error) {
    try {
      return await renderLitefuseTextPrompt({
        name: hasContext ? promptNames.docAnswer : promptNames.noContext,
        fallback,
        variables: {
          instructions,
          question: input.question,
          context: input.context,
          citations: JSON.stringify(input.citations),
        },
      });
    } catch {
      return resultFromMessages(fallbackMessages);
    }
  }
}

function docAnswerFallbackMessages(input: { question: string; context: string; instructions: string }) {
  return [
    {
      role: "system",
      content: [
        input.instructions,
        "Use only the provided context.",
        "If it is insufficient, say so.",
        "Do not guess.",
        "Cite as [1].",
      ].join("\n"),
    },
    {
      role: "user",
      content: [`Question: ${input.question}`, `Context: ${input.context}`].join("\n"),
    },
  ] satisfies ChatMessage[];
}

function noContextFallbackMessages(question: string, instructions: string) {
  return [
    {
      role: "system",
      content: [
        instructions,
        "No relevant context was retrieved.",
        "Answer briefly that there is not enough document context.",
        "Do not invent facts.",
        "Do not invent citations.",
      ].join("\n"),
    },
    { role: "user", content: `Question:\n${question}` },
  ] satisfies ChatMessage[];
}
