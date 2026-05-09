import { NextResponse } from "next/server";
import { createDocumentsRepo, createIngestionRepo, createProjectsRepo } from "@selectdb/db";
import { ingestDocument } from "@selectdb/jobs";
import { createLogger, serializeError } from "@selectdb/logger";
import { BadRequestError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb, getDoris } from "../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const log = createLogger({ component: "web.api.projects.ingest", projectId });

  try {
    const requestStartedAt = Date.now();
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
    log.info("project ingestion request started", {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
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

    const results: Array<{ sourcePath: string; documentId: string; ingestionId: string; status: string; chunkCount?: number; error?: string }> = [];
    let failed = 0;

    for (const file of files) {
      const sourcePath = normalizeSourcePath(file.name);
      const fileStartedAt = Date.now();
      log.info("project file ingestion started", {
        organizationId: ctx.organizationId,
        sourcePath,
        size: file.size,
        mimeType: mimeTypeForPath(sourcePath),
      });
      const existing = existingByPath.get(sourcePath);
      const document =
        existing ??
        (await documentsRepo.create({
          id: crypto.randomUUID(),
          organizationId: ctx.organizationId,
          projectId,
          title: titleFromSourcePath(sourcePath),
          sourceType: "project_upload",
          mimeType: mimeTypeForPath(sourcePath),
          metadata: { projectId, sourcePath, sourceKind: "project_file" },
          createdBy: ctx.userId,
        }));
      if (!document) throw new Error(`Failed to create document for ${sourcePath}`);

      const job = await ingestionRepo.create({
        id: crypto.randomUUID(),
        organizationId: ctx.organizationId,
        documentId: document.id,
        metadata: { projectId, sourcePath, mimeType: mimeTypeForPath(sourcePath) },
      });
      if (!job) throw new Error(`Failed to create ingestion job for ${sourcePath}`);

      try {
        const result = await ingestDocument({
          organizationId: ctx.organizationId,
          documentId: document.id,
          ingestionId: job.id,
          content: await file.text(),
          mimeType: mimeTypeForPath(sourcePath),
          title: titleFromSourcePath(sourcePath),
          sourceUri: sourcePath,
          metadata: { projectId, sourcePath, sourceKind: "project_file" },
          db,
          doris,
        });
        results.push({ sourcePath, documentId: document.id, ingestionId: job.id, status: "completed", chunkCount: result.chunkCount });
        log.info("project file ingestion completed", {
          organizationId: ctx.organizationId,
          sourcePath,
          documentId: document.id,
          ingestionId: job.id,
          chunkCount: result.chunkCount,
          durationMs: Date.now() - fileStartedAt,
        });
      } catch (error) {
        failed += 1;
        log.error("project file ingestion failed", {
          organizationId: ctx.organizationId,
          sourcePath,
          documentId: document.id,
          ingestionId: job.id,
          durationMs: Date.now() - fileStartedAt,
          error: serializeError(error),
        });
        results.push({
          sourcePath,
          documentId: document.id,
          ingestionId: job.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown ingestion error",
        });
      }
    }

    await projectsRepo.updateStatus(ctx.organizationId, projectId, failed === files.length ? "failed" : "ready");
    log.info("project ingestion request completed", {
      organizationId: ctx.organizationId,
      fileCount: files.length,
      completedCount: files.length - failed,
      failedCount: failed,
      durationMs: Date.now() - requestStartedAt,
    });

    return NextResponse.json({
      projectId,
      status: failed === files.length ? "failed" : "ready",
      fileCount: files.length,
      completedCount: files.length - failed,
      failedCount: failed,
      results,
    });
  } catch (error) {
    log.error("project ingestion request failed", { error: serializeError(error) });
    return errorResponse(error);
  }
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
