export interface ProjectSummary {
  id: string;
  organizationId: string;
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

export interface IngestTask {
  id: string;
  status: string;
  fileCount: number;
  processedCount: number;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  files: IngestResult[];
}
