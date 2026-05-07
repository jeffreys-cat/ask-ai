import type { RetrievedChunk } from "@selectdb/shared";

export interface RetrieveDocsToolResult {
  chunks: RetrievedChunk[];
}

export function createRetrieveDocsTool(search: () => Promise<RetrievedChunk[]>) {
  return {
    id: "retrieve-docs",
    description: "Retrieve organization-scoped document chunks for a question.",
    execute: async (): Promise<RetrieveDocsToolResult> => ({ chunks: await search() }),
  };
}
