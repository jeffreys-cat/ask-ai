import { NextResponse } from "next/server";
import { createProjectApiKeysRepo, createProjectsRepo } from "@selectdb/db";
import { BadRequestError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string; keyId: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { projectId, keyId } = await context.params;
    const ctx = getRequestContext(request.headers);
    const project = await createProjectsRepo(getDb()).findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");

    const key = await createProjectApiKeysRepo(getDb()).revoke({ organizationId: ctx.organizationId, projectId, keyId });
    if (!key) throw new BadRequestError("api key not found");

    return NextResponse.json({ key });
  } catch (error) {
    const status = error instanceof BadRequestError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}
