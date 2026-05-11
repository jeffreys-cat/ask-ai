import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalIngestSourceStorage } from "./source-storage";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("local ingest source storage", () => {
  it("stores, reads, and deletes markdown content by local URI", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "ingest-sources-"));
    tempDirs.push(rootDir);
    const storage = createLocalIngestSourceStorage({ rootDir });

    const result = await storage.put({
      organizationId: "org-1",
      taskId: "task-1",
      ingestionId: "job-1",
      filename: "docs/start.mdx",
      content: "# Start\n\nHello",
    });

    expect(result.sourceUri).toBe("local://org-1/task-1/job-1.mdx");
    expect(result.size).toBe(Buffer.byteLength("# Start\n\nHello", "utf8"));
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(storage.get(result.sourceUri)).resolves.toBe("# Start\n\nHello");

    await storage.delete(result.sourceUri);
    await expect(storage.get(result.sourceUri)).rejects.toThrow();
  });

  it("sanitizes path segments before writing", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "ingest-sources-"));
    tempDirs.push(rootDir);
    const storage = createLocalIngestSourceStorage({ rootDir });

    const result = await storage.put({
      organizationId: "../org",
      taskId: "task/one",
      ingestionId: "job:one",
      filename: "README.md",
      content: "safe",
    });

    expect(result.sourceUri).toBe("local://.._org/task_one/job_one.md");
    await expect(storage.get(result.sourceUri)).resolves.toBe("safe");
  });
});
