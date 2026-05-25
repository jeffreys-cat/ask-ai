import { NextResponse } from "next/server";
import { createDocumentsRepo } from "@selectdb/db";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { getRequestContext } from "../../../lib/auth";
import { getDb } from "../../../lib/runtime";

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request.headers);
    const body = (await request.json()) as {
      title?: string;
      sourceType?: "upload" | "paste" | "url" | "project_upload";
      mimeType?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.title?.trim()) throw new BadRequestError("title is required");
    if (body.sourceType !== "upload" && body.sourceType !== "paste" && body.sourceType !== "url" && body.sourceType !== "project_upload") {
      throw new BadRequestError("sourceType must be upload, paste, url or project_upload");
    }

    const repo = createDocumentsRepo(getDb());
    const document = await repo.create({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      title: body.title.trim(),
      sourceType: body.sourceType,
      mimeType: body.mimeType,
      metadata: body.metadata ?? {},
      createdBy: ctx.userId,
    });
    if (!document) throw new Error("Failed to create document");

    return NextResponse.json({ documentId: document.id, status: document.status });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
