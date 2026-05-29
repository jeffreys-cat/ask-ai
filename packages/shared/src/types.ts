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

export interface MetadataFilters {
  version?: string | string[];
  language?: string | string[];
  productLine?: string | string[];
  publishedAt?: {
    from?: string;
    to?: string;
  };
}

export interface AccessContext {
  userId?: string;
  apiKeyId?: string;
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
  retrieval?: {
    mode: "hybrid";
    vectorScore?: number;
    keywordScore?: number;
    vectorRank?: number;
    keywordRank?: number;
    fusionScore?: number;
    fusionRank?: number;
    rerank?: {
      provider: string;
      model: string;
      score: number;
      rank: number;
    };
    matchedBy: Array<"vector" | "keyword">;
  };
}

export interface RetrievalTraceCandidate {
  documentId: string;
  chunkId: string;
  rank: number;
  score: number;
  title?: string;
  sourceUri?: string;
  vectorScore?: number;
  keywordScore?: number;
  vectorRank?: number;
  keywordRank?: number;
  fusionScore?: number;
  fusionRank?: number;
  matchedBy?: Array<"vector" | "keyword">;
}

export type RetrievalTraceEvent =
  | {
      type: "vector_candidates";
      topK: number;
      candidateK: number;
      returnedCount: number;
      latencyMs: number;
      candidates: RetrievalTraceCandidate[];
    }
  | {
      type: "keyword_candidates";
      query: string;
      topK: number;
      candidateK: number;
      returnedCount: number;
      latencyMs: number;
      fallback?: boolean;
      error?: string;
      candidates: RetrievalTraceCandidate[];
    }
  | {
      type: "rrf_fusion";
      topK: number;
      rrfK: number;
      vectorCount: number;
      keywordCount: number;
      overlapCount: number;
      returnedCount: number;
      candidates: RetrievalTraceCandidate[];
    };

export interface Citation {
  id: string;
  documentId: string;
  chunkId: string;
  title: string;
  excerpt: string;
  score?: number;
  retrieval?: RetrievedChunk["retrieval"];
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
  | { type: "request_rewrite"; originalQuestion: string; query: string; changed: boolean; fallback?: boolean; error?: string }
  | { type: "answer_delta"; delta: string }
  | { type: "retrieved_chunks"; chunks: RetrievedChunk[] }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };
