import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createDb, createIngestionRepo, createProjectsRepo } from "@selectdb/db";
import { createDorisPool } from "@selectdb/doris";
import { createLogger, serializeError } from "@selectdb/logger";
import { fetchWebDocument } from "@selectdb/web-crawler";
import { ingestDocument } from "./ingest-document";
import { loadRootEnv } from "./load-env";
import { createIngestSourceStorage } from "./source-storage";

loadRootEnv();

const workerIdPrefix = process.env.INGEST_WORKER_ID ?? "ingest-worker";
const workerInstanceId = `${workerIdPrefix}-${hostname()}-${process.pid}-${randomUUID()}`;
const concurrency = parseInteger(process.env.INGEST_WORKER_CONCURRENCY, 1);
const pollIntervalMs = parseInteger(process.env.INGEST_WORKER_POLL_INTERVAL_MS, 2_000);
const leaseTimeoutMs = parseInteger(process.env.INGEST_WORKER_LEASE_TIMEOUT_MS, 5 * 60_000);
const heartbeatIntervalMs = parseInteger(process.env.INGEST_WORKER_HEARTBEAT_INTERVAL_MS, 15_000);
const maxAttempts = parseInteger(process.env.INGEST_WORKER_MAX_ATTEMPTS, 3);
const log = createLogger({ component: "jobs.ingest-worker", workerId: workerInstanceId });

let shuttingDown = false;

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

async function main() {
  const db = createDb();
  const doris = createDorisPool();
  const ingestionRepo = createIngestionRepo(db);
  const projectsRepo = createProjectsRepo(db);
  const sourceStorage = createIngestSourceStorage();

  log.info("ingest worker started", { concurrency, pollIntervalMs, leaseTimeoutMs, heartbeatIntervalMs, maxAttempts });

  try {
    await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        runWorkerSlot({
          slotId: index + 1,
          workerId: concurrency === 1 ? workerInstanceId : `${workerInstanceId}-${index + 1}`,
          db,
          doris,
          ingestionRepo,
          projectsRepo,
          sourceStorage,
        }),
      ),
    );
  } finally {
    await Promise.allSettled([db.end({ timeout: 5 }), doris.end()]);
    log.info("ingest worker stopped");
  }
}

async function runWorkerSlot(input: {
  slotId: number;
  workerId: string;
  db: ReturnType<typeof createDb>;
  doris: ReturnType<typeof createDorisPool>;
  ingestionRepo: ReturnType<typeof createIngestionRepo>;
  projectsRepo: ReturnType<typeof createProjectsRepo>;
  sourceStorage: ReturnType<typeof createIngestSourceStorage>;
}) {
  const slotLog = log.child({ slotId: input.slotId, slotWorkerId: input.workerId });
  slotLog.info("ingest worker slot started");

  while (!shuttingDown) {
    const job = await input.ingestionRepo.claimNext({
      workerId: input.workerId,
      staleBefore: new Date(Date.now() - leaseTimeoutMs),
      maxAttempts,
    });

    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }

    await processJob({
      job,
      workerId: input.workerId,
      slotId: input.slotId,
      db: input.db,
      doris: input.doris,
      ingestionRepo: input.ingestionRepo,
      projectsRepo: input.projectsRepo,
      sourceStorage: input.sourceStorage,
    });
  }

  slotLog.info("ingest worker slot stopped");
}

async function processJob(input: {
  job: Awaited<ReturnType<ReturnType<typeof createIngestionRepo>["claimNext"]>>;
  workerId: string;
  slotId: number;
  db: ReturnType<typeof createDb>;
  doris: ReturnType<typeof createDorisPool>;
  ingestionRepo: ReturnType<typeof createIngestionRepo>;
  projectsRepo: ReturnType<typeof createProjectsRepo>;
  sourceStorage: ReturnType<typeof createIngestSourceStorage>;
}) {
  const job = input.job;
  if (!job) return;

  const metadata = job.metadata as Record<string, unknown>;
  const projectId = stringMetadata(metadata, "projectId");
  const taskId = stringMetadata(metadata, "taskId");
  const sourcePath = stringMetadata(metadata, "sourcePath");
  const sourceUri = stringMetadata(metadata, "sourceUri");
  const sourceKind = stringMetadata(metadata, "sourceKind");
  const mimeType = stringMetadata(metadata, "mimeType") ?? "text/markdown";
  const jobLog = log.child({
    organizationId: job.organizationId,
    ingestionId: job.id,
    documentId: job.documentId,
    projectId,
    taskId,
    sourcePath,
    attempt: job.attempts,
    slotId: input.slotId,
    slotWorkerId: input.workerId,
  });

  const heartbeat = setInterval(() => {
    void input.ingestionRepo.heartbeat({ ingestionId: job.id, workerId: input.workerId }).catch((error) => {
      jobLog.warn("ingest job heartbeat failed", { error: serializeError(error) });
    });
  }, heartbeatIntervalMs);

  try {
    if (!projectId) throw new Error("Ingestion job is missing metadata.projectId");
    if (!sourcePath) throw new Error("Ingestion job is missing metadata.sourcePath");
    if (!sourceUri) throw new Error("Ingestion job is missing metadata.sourceUri");

    jobLog.info("ingest job started");
    const source =
      sourceKind === "web_url"
        ? await fetchWebDocument(sourceUri)
        : {
            content: await input.sourceStorage.get(sourceUri),
            mimeType,
            finalUrl: sourcePath,
          };
    const result = await ingestDocument({
      organizationId: job.organizationId,
      documentId: job.documentId,
      ingestionId: job.id,
      content: source.content,
      mimeType: sourceKind === "web_url" ? source.mimeType : mimeType,
      title: titleFromSourcePath(sourcePath),
      sourceUri: sourceKind === "web_url" ? source.finalUrl : sourcePath,
      metadata: { ...metadata, projectId, sourcePath, sourceKind: sourceKind === "web_url" ? "web_url" : "project_file" },
      db: input.db,
      doris: input.doris,
      manageIngestionStatus: false,
    });

    const completedJob = await input.ingestionRepo.complete({ ingestionId: job.id, workerId: input.workerId, chunkCount: result.chunkCount });
    if (!completedJob) {
      jobLog.warn("ingest job completion skipped because lock was lost");
      return;
    }
    if (sourceKind !== "web_url") await deleteSource(input.sourceStorage, sourceUri, jobLog);
    await refreshProjectStatus(input.ingestionRepo, input.projectsRepo, job.organizationId, projectId, taskId);
    jobLog.info("ingest job completed", { chunkCount: result.chunkCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    const shouldRetry = job.attempts < maxAttempts;
    jobLog.error("ingest job failed", { shouldRetry, error: serializeError(error) });

    if (shouldRetry) {
      const releasedJob = await input.ingestionRepo.releaseForRetry({ ingestionId: job.id, workerId: input.workerId, error: message });
      if (!releasedJob) jobLog.warn("ingest job retry release skipped because lock was lost");
    } else {
      const failedJob = await input.ingestionRepo.fail({ ingestionId: job.id, workerId: input.workerId, error: message });
      if (!failedJob) {
        jobLog.warn("ingest job failure update skipped because lock was lost");
        return;
      }
      if (projectId) await refreshProjectStatus(input.ingestionRepo, input.projectsRepo, job.organizationId, projectId, taskId);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function refreshProjectStatus(
  ingestionRepo: ReturnType<typeof createIngestionRepo>,
  projectsRepo: ReturnType<typeof createProjectsRepo>,
  organizationId: string,
  projectId: string,
  taskId?: string,
) {
  const activeJobs = await ingestionRepo.listActiveByProject(organizationId, projectId);
  if (activeJobs.length > 0) {
    await projectsRepo.updateStatus(organizationId, projectId, "ingesting");
    return;
  }

  const taskJobs = taskId ? await ingestionRepo.listByTask(organizationId, taskId) : [];
  const allTaskJobsFailed = taskJobs.length > 0 && taskJobs.every((taskJob) => taskJob.status === "failed");
  await projectsRepo.updateStatus(organizationId, projectId, allTaskJobsFailed ? "failed" : "ready");
}

async function deleteSource(sourceStorage: ReturnType<typeof createIngestSourceStorage>, sourceUri: string, jobLog: typeof log) {
  try {
    await sourceStorage.delete(sourceUri);
  } catch (error) {
    jobLog.warn("completed ingest source delete failed", { sourceUri, error: serializeError(error) });
  }
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function titleFromSourcePath(path: string) {
  return path.replace(/\\/g, "/").split("/").pop()?.replace(/\.(md|mdx)$/i, "") || path;
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  log.error("ingest worker crashed", { error: serializeError(error) });
  process.exit(1);
});
