import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");

export interface SourceStoragePutInput {
  organizationId: string;
  taskId: string;
  ingestionId: string;
  filename: string;
  content: string;
}

export interface SourceStoragePutResult {
  sourceUri: string;
  size: number;
  checksum: string;
}

export interface IngestSourceStorage {
  put(input: SourceStoragePutInput): Promise<SourceStoragePutResult>;
  get(sourceUri: string): Promise<string>;
  delete(sourceUri: string): Promise<void>;
}

export function createIngestSourceStorage(env: NodeJS.ProcessEnv = process.env): IngestSourceStorage {
  const kind = env.INGEST_SOURCE_STORAGE ?? "local";
  if (kind !== "local") {
    throw new Error(`INGEST_SOURCE_STORAGE=${kind} is not implemented yet`);
  }
  return createLocalIngestSourceStorage({
    rootDir: resolveStorageRoot(env.INGEST_SOURCE_LOCAL_DIR ?? path.join(".data", "ingest-sources")),
  });
}

export function createLocalIngestSourceStorage({ rootDir }: { rootDir: string }): IngestSourceStorage {
  const absoluteRoot = path.resolve(rootDir);

  return {
    async put(input) {
      const extension = safeExtension(input.filename);
      const relativePath = path.join(safeSegment(input.organizationId), safeSegment(input.taskId), `${safeSegment(input.ingestionId)}${extension}`);
      const absolutePath = path.join(absoluteRoot, relativePath);
      if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
        throw new Error("Invalid ingest source path");
      }

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.content, "utf8");

      return {
        sourceUri: `local://${relativePath.split(path.sep).join("/")}`,
        size: Buffer.byteLength(input.content, "utf8"),
        checksum: checksum(input.content),
      };
    },

    async get(sourceUri) {
      return readFile(resolveLocalUri(absoluteRoot, sourceUri), "utf8");
    },

    async delete(sourceUri) {
      await rm(resolveLocalUri(absoluteRoot, sourceUri), { force: true });
    },
  };
}

function resolveLocalUri(rootDir: string, sourceUri: string) {
  if (!sourceUri.startsWith("local://")) {
    throw new Error(`Unsupported ingest source URI: ${sourceUri}`);
  }
  const relativePath = sourceUri.slice("local://".length);
  const absolutePath = path.join(rootDir, relativePath);
  if (!absolutePath.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error("Invalid ingest source URI");
  }
  return absolutePath;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeExtension(filename: string) {
  return filename.toLowerCase().endsWith(".mdx") ? ".mdx" : ".md";
}

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function resolveStorageRoot(rootDir: string) {
  return path.isAbsolute(rootDir) ? rootDir : path.join(workspaceRoot, rootDir);
}
