import { splitTextIntoChunks, type SplitOptions } from "./splitter";

export function chunkMarkdown(markdown: string, options: SplitOptions) {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>]/g, "");

  return splitTextIntoChunks(stripped, { ...options, metadata: { ...(options.metadata ?? {}), parser: "markdown" } });
}
