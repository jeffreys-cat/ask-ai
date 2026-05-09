import { NextResponse } from "next/server";
import { createProjectsRepo } from "@selectdb/db";
import { BadRequestError } from "@selectdb/shared";
import { getRequestContext } from "../../../../lib/auth";
import { getDb } from "../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const ctx = getRequestContext(request.headers);
    const project = await createProjectsRepo(getDb()).findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");
    return NextResponse.json({ project });
  } catch (error) {
    const status = error instanceof BadRequestError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}
