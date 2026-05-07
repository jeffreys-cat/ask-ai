import type { JsonObject } from "@selectdb/shared";

export interface TextChunk {
  chunkId: string;
  content: string;
  order: number;
  startOffset: number;
  endOffset: number;
  metadata: JsonObject;
}

export interface SplitOptions {
  documentId: string;
  maxChars?: number;
  overlapChars?: number;
  metadata?: JsonObject;
}

export function splitTextIntoChunks(text: string, options: SplitOptions): TextChunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = options.overlapChars ?? 160;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const chunks: TextChunk[] = [];

  if (!normalized) return chunks;

  let cursor = 0;
  let order = 0;
  while (cursor < normalized.length) {
    const hardEnd = Math.min(cursor + maxChars, normalized.length);
    const softEnd = findSoftBoundary(normalized, cursor, hardEnd);
    const content = normalized.slice(cursor, softEnd).trim();

    if (content) {
      chunks.push({
        chunkId: `${options.documentId}:${order}`,
        content,
        order,
        startOffset: cursor,
        endOffset: softEnd,
        metadata: { ...(options.metadata ?? {}), order, startOffset: cursor, endOffset: softEnd },
      });
      order += 1;
    }

    if (softEnd >= normalized.length) break;
    cursor = Math.max(softEnd - overlapChars, cursor + 1);
  }

  return chunks;
}

function findSoftBoundary(text: string, start: number, hardEnd: number) {
  if (hardEnd >= text.length) return text.length;
  const window = text.slice(start, hardEnd);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph > hardEnd * 0.25) return start + paragraph;
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("。"), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentence > window.length * 0.5) return start + sentence + 1;
  const space = window.lastIndexOf(" ");
  return space > window.length * 0.5 ? start + space : hardEnd;
}
