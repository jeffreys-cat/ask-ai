import { NextResponse } from "next/server";
import { createProjectsRepo } from "@selectdb/db";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { getRequestContext } from "../../../lib/auth";
import { getDb } from "../../../lib/runtime";

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext(request.headers);
    const projects = await createProjectsRepo(getDb()).list(ctx.organizationId);
    return NextResponse.json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request.headers);
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.name?.trim()) throw new BadRequestError("name is required");

    const project = await createProjectsRepo(getDb()).create({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      metadata: body.metadata ?? {},
      createdBy: ctx.userId,
    });
    if (!project) throw new Error("Failed to create project");

    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
