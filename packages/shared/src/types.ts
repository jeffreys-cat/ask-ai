export type ID = string;

export type SourceType = "upload" | "paste" | "url";
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

export type AskStreamEvent =
  | { type: "answer_delta"; delta: string }
  | { type: "retrieved_chunks"; chunks: RetrievedChunk[] }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };
