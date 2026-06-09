import type { RetrievedChunk } from "@selectdb/shared";

export function packContext(chunks: RetrievedChunk[], maxChars = 6000, maxChunkChars = 1200) {
  return packContextChunks(chunks, maxChars, maxChunkChars)
    .map((chunk, index) => `[${index + 1}] ${chunk.title ?? chunk.documentId}\n${chunk.content}`)
    .join("\n\n");
}

export function packContextChunks(chunks: RetrievedChunk[], maxChars = 6000, maxChunkChars = 1200) {
  let used = 0;
  const packed: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    const content = compressChunkContent(chunk.content, maxChunkChars);
    if (used + content.length > maxChars && packed.length > 0) break;
    packed.push({ ...chunk, content });
    used += content.length;
  }

  return packed;
}

function compressChunkContent(content: string, maxChars: number) {
  const normalized = content.trim().replace(/\r\n/g, "\n");
  if (normalized.length <= maxChars) return normalized;

  const headChars = Math.max(Math.floor(maxChars * 0.7), 1);
  const tailChars = Math.max(maxChars - headChars - 18, 0);
  const head = normalized.slice(0, headChars).trimEnd();
  const tail = tailChars > 0 ? normalized.slice(-tailChars).trimStart() : "";

  if (!tail) return `${head}\n...[truncated]...`;
  return `${head}\n...[truncated]...\n${tail}`;
}
