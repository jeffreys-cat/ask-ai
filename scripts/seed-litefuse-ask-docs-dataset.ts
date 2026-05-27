import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { ASK_DOCS_EVAL_DATASET_NAME, getLitefuseClient, normalizeAskDocsEvalItem } from "@selectdb/ai";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file ?? "eval/ask-docs.samples.example.json";
  const datasetName = args.dataset ?? process.env.LITEFUSE_EVAL_DATASET ?? ASK_DOCS_EVAL_DATASET_NAME;
  const client = getLitefuseClient();
  if (!client) throw new Error("LITEFUSE_PUBLIC_KEY and LITEFUSE_SECRET_KEY are required to seed eval datasets");

  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const object = raw && typeof raw === "object" ? (raw as { items?: unknown }) : {};
  const items = Array.isArray(raw) ? raw : Array.isArray(object.items) ? object.items : [];
  if (items.length === 0) throw new Error(`No eval items found in ${file}`);

  await client
    .createDataset({
      name: datasetName,
      description: "Ask AI documentation Q&A evaluation dataset.",
      metadata: { source: file, schema: "ask-docs-eval-v1" },
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("409") && !message.toLowerCase().includes("already")) throw error;
    });

  for (const rawItem of items) {
    const item = normalizeAskDocsEvalItem(rawItem as { input?: unknown; expectedOutput?: unknown; metadata?: unknown });
    await client.createDatasetItem({
      datasetName,
      id: stableItemId(datasetName, item.input.question, item.input.projectId),
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    });
  }

  await client.flush();
  console.log(`Seeded ${items.length} items into Litefuse dataset ${datasetName}.`);
}

function stableItemId(datasetName: string, question: string, projectId?: string) {
  return createHash("sha256").update(`${datasetName}:${projectId ?? ""}:${question}`).digest("hex").slice(0, 32);
}

function parseArgs(args: string[]) {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) continue;
    const normalized = key.slice(2);
    const next = args[index + 1];
    parsed[normalized] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed as { dataset?: string; file?: string };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
