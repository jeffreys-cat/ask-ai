export type ID = string;

export type SourceType = "upload" | "paste" | "url" | "project_upload";
export type ProjectStatus = "created" | "ingesting" | "ready" | "failed" | "deleted";
export type DocumentStatus = "created" | "ingesting" | "ready" | "failed" | "deleted";
export type IngestionStatus = "queued" | "running" | "completed" | "failed";

export type JsonObject = Record<string, unknown>;

export interface RequestContext {
  userId: string;
  organizationId: string;
}

export interface DocumentChunk {
  organizationId: string;
  documentId: string;
  chunkId: string;
  content: string;
  title?: string;
  sourceUri?: string;
  metadata: JsonObject;
  embedding: number[];
}

export interface RetrievedChunk extends Omit<DocumentChunk, "embedding"> {
  score: number;
}

export interface Citation {
  id: string;
  documentId: string;
  chunkId: string;
  title: string;
  excerpt: string;
  score?: number;
  sourceUri?: string;
}

export interface AskAgentInput {
  id: string;
  name: string;
  instructions: string;
}

export const ASK_DOC_ANSWER_AGENT = {
  id: "doc-answer-agent",
  name: "Documentation answer agent",
  instructions:
    "Answer from retrieved organization-scoped document context. Be concise and cite sources with bracketed citation numbers.",
} satisfies AskAgentInput;

export type AskStreamEvent =
  | { type: "answer_delta"; delta: string }
  | { type: "retrieved_chunks"; chunks: RetrievedChunk[] }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };
