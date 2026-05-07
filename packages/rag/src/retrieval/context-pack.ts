import type { RetrievedChunk } from "@selectdb/shared";

export function packContext(chunks: RetrievedChunk[], maxChars = 6000) {
  let used = 0;
  const packed: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    if (used + chunk.content.length > maxChars && packed.length > 0) break;
    packed.push(chunk);
    used += chunk.content.length;
  }

  return packed
    .map((chunk, index) => `[${index + 1}] ${chunk.title ?? chunk.documentId}\n${chunk.content}`)
    .join("\n\n");
}
