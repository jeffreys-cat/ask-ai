import { NextResponse } from "next/server";
import { createDocumentsRepo, createIngestionRepo, createProjectsRepo } from "@selectdb/db";
import { createIngestSourceStorage } from "@selectdb/jobs";
import { createLogger, serializeError } from "@selectdb/logger";
import { BadRequestError } from "@selectdb/shared";
import { discoverSitemapUrls } from "@selectdb/web-crawler";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
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
    const projectsRepo = createProjectsRepo(db);
    const documentsRepo = createDocumentsRepo(db);
    const ingestionRepo = createIngestionRepo(db);
    const sourceStorage = createIngestSourceStorage();
    const project = await projectsRepo.findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");

    if (isJsonRequest(request)) {
      return createUrlIngestTask(request, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        projectId,
        projectsRepo,
        documentsRepo,
        ingestionRepo,
        log,
      });
    }

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

    let queuedCount = 0;

    for (const file of files) {
      const sourcePath = normalizeSourcePath(file.name);
      const mimeType = mimeTypeForPath(sourcePath);
      const ingestionId = crypto.randomUUID();
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

      const source = await sourceStorage.put({
        organizationId: ctx.organizationId,
        taskId,
        ingestionId,
        filename: sourcePath,
        content: await file.text(),
      });

      const job = await ingestionRepo
        .create({
          id: ingestionId,
          organizationId: ctx.organizationId,
          documentId: document.id,
          metadata: {
            projectId,
            taskId,
            sourcePath,
            sourceUri: source.sourceUri,
            mimeType,
            size: source.size,
            checksum: source.checksum,
          },
        })
        .catch(async (error) => {
          await sourceStorage.delete(source.sourceUri);
          throw error;
        });
      if (!job) {
        await sourceStorage.delete(source.sourceUri);
        throw new Error(`Failed to create ingestion job for ${sourcePath}`);
      }
      queuedCount += 1;
    }

    return NextResponse.json({
      projectId,
      taskId,
      status: "queued",
      fileCount: queuedCount,
    });
  } catch (error) {
    log.error("project ingestion request failed", { error: serializeError(error) });
    return errorResponse(error);
  }
}

async function createUrlIngestTask(
  request: Request,
  input: {
    organizationId: string;
    userId: string;
    projectId: string;
    projectsRepo: ReturnType<typeof createProjectsRepo>;
    documentsRepo: ReturnType<typeof createDocumentsRepo>;
    ingestionRepo: ReturnType<typeof createIngestionRepo>;
    log: ReturnType<typeof createLogger>;
  },
) {
  const payload = (await request.json()) as { source?: unknown; url?: unknown };
  if (payload.source !== "url") throw new BadRequestError("unsupported ingest source");
  if (typeof payload.url !== "string" || payload.url.trim().length === 0) throw new BadRequestError("url is required");

  const pages = await discoverSitemapUrls(payload.url.trim());
  if (pages.length === 0) throw new BadRequestError("no sitemap URLs found");

  const taskId = crypto.randomUUID();
  input.log.info("project URL ingestion task created", {
    organizationId: input.organizationId,
    userId: input.userId,
    taskId,
    url: payload.url,
    pageCount: pages.length,
  });

  await input.projectsRepo.updateStatus(input.organizationId, input.projectId, "ingesting");
  const existingDocuments = await input.documentsRepo.listByProject(input.organizationId, input.projectId);
  const existingByUrl = new Map(
    existingDocuments
      .map((document) => {
        const metadata = document.metadata as Record<string, unknown>;
        const url = typeof metadata.url === "string" ? metadata.url : typeof metadata.sourceUri === "string" ? metadata.sourceUri : "";
        return [url, document] as const;
      })
      .filter(([url]) => url.length > 0),
  );

  let queuedCount = 0;
  for (const page of pages) {
    const ingestionId = crypto.randomUUID();
    const sourcePath = page.url;
    const existing = existingByUrl.get(page.url);
    const document =
      existing ??
      (await input.documentsRepo.create({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        title: titleFromUrl(page.url),
        sourceType: "url",
        mimeType: "text/html",
        metadata: {
          projectId: input.projectId,
          taskId,
          sourcePath,
          sourceUri: page.url,
          sourceKind: "web_url",
          url: page.url,
          sitemapUrl: page.sitemapUrl,
          lastmod: page.lastmod,
        },
        createdBy: input.userId,
      }));
    if (!document) throw new Error(`Failed to create document for ${page.url}`);

    const job = await input.ingestionRepo.create({
      id: ingestionId,
      organizationId: input.organizationId,
      documentId: document.id,
      metadata: {
        projectId: input.projectId,
        taskId,
        sourcePath,
        sourceUri: page.url,
        sourceKind: "web_url",
        mimeType: "text/html",
        url: page.url,
        sitemapUrl: page.sitemapUrl,
        lastmod: page.lastmod,
      },
    });
    if (!job) throw new Error(`Failed to create ingestion job for ${page.url}`);
    queuedCount += 1;
  }

  return NextResponse.json({
    projectId: input.projectId,
    taskId,
    status: "queued",
    fileCount: queuedCount,
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

function titleFromUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const path = url.pathname.replace(/\/$/, "");
  return decodeURIComponent(path.split("/").pop() || url.hostname);
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.includes("application/json") ?? false;
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
