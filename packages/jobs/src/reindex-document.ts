import { ingestDocument, type IngestDocumentInput } from "./ingest-document";

export async function reindexDocument(input: IngestDocumentInput) {
  return ingestDocument(input);
}
