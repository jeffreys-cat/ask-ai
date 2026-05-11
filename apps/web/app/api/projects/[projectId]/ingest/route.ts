import { after, NextResponse } from "next/server";
import { createDocumentsRepo, createIngestionRepo, createProjectsRepo } from "@selectdb/db";
import type { DbClient } from "@selectdb/db";
import type { DorisPool } from "@selectdb/doris";
import { ingestDocument } from "@selectdb/jobs";
import { createLogger, serializeError } from "@selectdb/logger";
import { BadRequestError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb, getDoris } from "../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface QueuedProjectFile {
  sourcePath: string;
  documentId: string;
  ingestionId: string;
  content: string;
  mimeType: string;
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const log = createLogger({ component: "web.api.projects.ingest.list", projectId });

  try {
    const ctx = getRequestContext(request.headers);
    const db = getDb();
    const projectsRepo = createProjectsRepo(db);
    const ingestionRepo = createIngestionRepo(db);
    const project = await projectsRepo.findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");

    const jobs = await ingestionRepo.listByProject(ctx.organizationId, projectId);
    return NextResponse.json({ projectId, tasks: buildIngestTasks(jobs) });
  } catch (error) {
    log.error("project ingestion task list failed", { error: serializeError(error) });
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const log = createLogger({ component: "web.api.projects.ingest", projectId });

  try {
    const ctx = getRequestContext(request.headers);
    const db = getDb();
    const doris = getDoris();
    const projectsRepo = createProjectsRepo(db);
    const documentsRepo = createDocumentsRepo(db);
    const ingestionRepo = createIngestionRepo(db);
    const project = await projectsRepo.findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");

    const form = await request.formData();
    const files = form.getAll("files").filter((file): file is File => file instanceof File && isMarkdownFile(file.name));
    if (files.length === 0) throw new BadRequestError("at least one .md or .mdx file is required");
    const taskId = crypto.randomUUID();
    log.info("project ingestion task created", {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      taskId,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    });

    await projectsRepo.updateStatus(ctx.organizationId, projectId, "ingesting");
    const existingDocuments = await documentsRepo.listByProject(ctx.organizationId, projectId);
    const existingByPath = new Map(
      existingDocuments
        .map((document) => [String((document.metadata as Record<string, unknown>).sourcePath ?? ""), document] as const)
        .filter(([sourcePath]) => sourcePath.length > 0),
    );

    const queuedFiles: QueuedProjectFile[] = [];

    for (const file of files) {
      const sourcePath = normalizeSourcePath(file.name);
      const mimeType = mimeTypeForPath(sourcePath);
      const existing = existingByPath.get(sourcePath);
      const document =
        existing ??
        (await documentsRepo.create({
          id: crypto.randomUUID(),
          organizationId: ctx.organizationId,
          projectId,
          title: titleFromSourcePath(sourcePath),
          sourceType: "project_upload",
          mimeType,
          metadata: { projectId, sourcePath, sourceKind: "project_file" },
          createdBy: ctx.userId,
        }));
      if (!document) throw new Error(`Failed to create document for ${sourcePath}`);

      const job = await ingestionRepo.create({
        id: crypto.randomUUID(),
        organizationId: ctx.organizationId,
        documentId: document.id,
        metadata: { projectId, taskId, sourcePath, mimeType },
      });
      if (!job) throw new Error(`Failed to create ingestion job for ${sourcePath}`);

      queuedFiles.push({
        sourcePath,
        documentId: document.id,
        ingestionId: job.id,
        content: await file.text(),
        mimeType,
      });
    }

    after(async () => {
      await runProjectIngestTask({
        organizationId: ctx.organizationId,
        projectId,
        taskId,
        files: queuedFiles,
        db,
        doris,
      });
    });

    return NextResponse.json({
      projectId,
      taskId,
      status: "queued",
      fileCount: queuedFiles.length,
    });
  } catch (error) {
    log.error("project ingestion request failed", { error: serializeError(error) });
    return errorResponse(error);
  }
}

async function runProjectIngestTask(input: {
  organizationId: string;
  projectId: string;
  taskId: string;
  files: QueuedProjectFile[];
  db: DbClient;
  doris: DorisPool;
}) {
  const log = createLogger({ component: "web.api.projects.ingest.worker", projectId: input.projectId, taskId: input.taskId });
  const projectsRepo = createProjectsRepo(input.db);
  let failed = 0;

  for (const file of input.files) {
    const fileStartedAt = Date.now();
    log.info("project file ingestion started", {
      organizationId: input.organizationId,
      sourcePath: file.sourcePath,
      documentId: file.documentId,
      ingestionId: file.ingestionId,
      mimeType: file.mimeType,
    });

    try {
      const result = await ingestDocument({
        organizationId: input.organizationId,
        documentId: file.documentId,
        ingestionId: file.ingestionId,
        content: file.content,
        mimeType: file.mimeType,
        title: titleFromSourcePath(file.sourcePath),
        sourceUri: file.sourcePath,
        metadata: { projectId: input.projectId, sourcePath: file.sourcePath, sourceKind: "project_file" },
        db: input.db,
        doris: input.doris,
      });
      log.info("project file ingestion completed", {
        organizationId: input.organizationId,
        sourcePath: file.sourcePath,
        documentId: file.documentId,
        ingestionId: file.ingestionId,
        chunkCount: result.chunkCount,
        durationMs: Date.now() - fileStartedAt,
      });
    } catch (error) {
      failed += 1;
      log.error("project file ingestion failed", {
        organizationId: input.organizationId,
        sourcePath: file.sourcePath,
        documentId: file.documentId,
        ingestionId: file.ingestionId,
        durationMs: Date.now() - fileStartedAt,
        error: serializeError(error),
      });
    }
  }

  await projectsRepo.updateStatus(input.organizationId, input.projectId, failed === input.files.length ? "failed" : "ready");
  log.info("project ingestion task completed", {
    organizationId: input.organizationId,
    fileCount: input.files.length,
    completedCount: input.files.length - failed,
    failedCount: failed,
  });
}

function buildIngestTasks(
  jobs: Awaited<ReturnType<ReturnType<typeof createIngestionRepo>["listByProject"]>>,
) {
  const taskMap = new Map<
    string,
    {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      fileCount: number;
      queuedCount: number;
      runningCount: number;
      completedCount: number;
      failedCount: number;
      chunkCount: number;
      files: Array<{
        sourcePath: string;
        documentId: string;
        ingestionId: string;
        status: string;
        chunkCount: number;
        error: string | null;
      }>;
    }
  >();

  for (const job of jobs) {
    const metadata = job.metadata as Record<string, unknown>;
    const documentMetadata = job.documentMetadata as Record<string, unknown>;
    const taskId = typeof metadata.taskId === "string" ? metadata.taskId : job.id;
    const sourcePath =
      typeof metadata.sourcePath === "string"
        ? metadata.sourcePath
        : typeof documentMetadata.sourcePath === "string"
          ? documentMetadata.sourcePath
          : job.documentTitle;
    const chunkCount = Number.parseInt(job.chunkCount, 10) || 0;
    let task = taskMap.get(taskId);

    if (!task) {
      task = {
        id: taskId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        fileCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        chunkCount: 0,
        files: [],
      };
      taskMap.set(taskId, task);
    }

    task.createdAt = job.createdAt < task.createdAt ? job.createdAt : task.createdAt;
    task.updatedAt = job.updatedAt > task.updatedAt ? job.updatedAt : task.updatedAt;
    task.fileCount += 1;
    task.chunkCount += chunkCount;
    if (job.status === "queued") task.queuedCount += 1;
    if (job.status === "running") task.runningCount += 1;
    if (job.status === "completed") task.completedCount += 1;
    if (job.status === "failed") task.failedCount += 1;
    task.files.push({
      sourcePath,
      documentId: job.documentId,
      ingestionId: job.id,
      status: job.status,
      chunkCount,
      error: job.error,
    });
  }

  return Array.from(taskMap.values())
    .map((task) => ({
      ...task,
      status: statusForTask(task),
      processedCount: task.completedCount + task.failedCount,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function statusForTask(task: { fileCount: number; completedCount: number; failedCount: number; runningCount: number; queuedCount: number }) {
  if (task.failedCount === task.fileCount) return "failed";
  if (task.completedCount + task.failedCount === task.fileCount) return task.failedCount > 0 ? "completed_with_errors" : "completed";
  if (task.runningCount > 0) return "running";
  if (task.queuedCount > 0) return "queued";
  return "running";
}

function isMarkdownFile(path: string) {
  return /\.(md|mdx)$/i.test(path);
}

function normalizeSourcePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function titleFromSourcePath(path: string) {
  return normalizeSourcePath(path).split("/").pop()?.replace(/\.(md|mdx)$/i, "") || path;
}

function mimeTypeForPath(path: string) {
  return path.toLowerCase().endsWith(".mdx") ? "text/mdx" : "text/markdown";
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
