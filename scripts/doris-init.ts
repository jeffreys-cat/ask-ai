import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";
import { assertSqlIdentifier, createDorisPool, getDorisConfig } from "@selectdb/doris";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dim = process.env.EMBEDDING_DIM;
  if (!dim) throw new Error("EMBEDDING_DIM is required");

  const sql = (await readFile(resolve(__dirname, "../packages/doris/src/schema.sql"), "utf8")).replaceAll("{{EMBEDDING_DIM}}", dim);
  const { database: _database, ...configWithoutDatabase } = getDorisConfig();
  const pool = createDorisPool(configWithoutDatabase);
  const enableAnnIndex = process.env.DORIS_ENABLE_ANN_INDEX === "true";
  const chunksTable = assertSqlIdentifier(process.env.DORIS_CHUNKS_TABLE ?? "document_chunks");

  try {
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      await pool.query(statement);
    }
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_document_chunks_content
      ON ${chunksTable} (content)
      USING INVERTED
      PROPERTIES (
        "lower_case" = "true",
        "parser" = "unicode",
        "support_phrase" = "true"
      )
    `);
    if (enableAnnIndex) {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
        ON ${chunksTable} (embedding)
        USING ANN
        PROPERTIES (
          "dim" = "${dim}",
          "index_type" = "hnsw",
          "metric_type" = "inner_product"
        )
      `);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
