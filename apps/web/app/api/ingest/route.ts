import { NextResponse } from "next/server";
import { createDocumentsRepo, createIngestionRepo } from "@selectdb/db";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { ingestDocument } from "@selectdb/jobs";
import { getRequestContext } from "../../../lib/auth";
import { getDb, getDoris } from "../../../lib/runtime";

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request.headers);
    const db = getDb();
    const documentsRepo = createDocumentsRepo(db);
    const ingestionRepo = createIngestionRepo(db);
    const parsed = await parseIngestRequest(request);

    const document = await documentsRepo.findById(ctx.organizationId, parsed.documentId);
    if (!document) throw new BadRequestError("document not found");

    const job = await ingestionRepo.create({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      documentId: document.id,
      metadata: { mimeType: parsed.mimeType },
    });
    if (!job) throw new Error("Failed to create ingestion job");

    const result = await ingestDocument({
      organizationId: ctx.organizationId,
      documentId: document.id,
      ingestionId: job.id,
      content: parsed.content,
      mimeType: parsed.mimeType ?? document.mimeType,
      title: document.title,
      metadata: { filename: parsed.filename },
      db,
      doris: getDoris(),
    });

    return NextResponse.json({ ingestionId: job.id, status: "completed", chunkCount: result.chunkCount });
  } catch (error) {
    const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}

async function parseIngestRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const documentId = String(form.get("documentId") ?? "");
    const file = form.get("file");
    if (!documentId) throw new BadRequestError("documentId is required");
    if (!(file instanceof File)) throw new BadRequestError("file is required");
    return {
      documentId,
      content: await file.text(),
      mimeType: file.type || "text/plain",
      filename: file.name,
    };
  }

  const body = (await request.json()) as { documentId?: string; content?: string; mimeType?: string };
  if (!body.documentId) throw new BadRequestError("documentId is required");
  if (!body.content) throw new BadRequestError("content is required");
  return { documentId: body.documentId, content: body.content, mimeType: body.mimeType ?? "text/plain" };
}
