CREATE DATABASE IF NOT EXISTS ask_ai;
USE ask_ai;

CREATE TABLE IF NOT EXISTS document_chunks (
  organization_id VARCHAR(128) NOT NULL,
  document_id VARCHAR(128) NOT NULL,
  chunk_id VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  title VARCHAR(512),
  source_uri VARCHAR(2048),
  metadata JSON,
  embedding ARRAY<FLOAT> NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
DUPLICATE KEY(organization_id, document_id, chunk_id)
DISTRIBUTED BY HASH(organization_id) BUCKETS 8
PROPERTIES (
  "replication_num" = "1"
);
