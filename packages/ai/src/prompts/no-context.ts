export function buildNoContextPrompt(question: string) {
  return [
    "The document retrieval step returned no relevant context.",
    "Answer briefly that there is not enough document context to answer. Do not invent citations.",
    "",
    `Question: ${question}`,
  ].join("\n");
}
