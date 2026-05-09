export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IngestResult {
  sourcePath: string;
  documentId: string;
  ingestionId: string;
  status: string;
  chunkCount?: number;
  error?: string;
}
