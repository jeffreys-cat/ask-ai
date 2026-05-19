import { NextResponse } from "next/server";
import {
  createProjectApiKeysRepo,
  createProjectsRepo,
  generateProjectApiKey,
  hashProjectApiKey,
  projectApiKeyMetadata,
} from "@selectdb/db";
import { BadRequestError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const ctx = getRequestContext(request.headers);
    await assertProject(ctx.organizationId, projectId);

    const keys = await createProjectApiKeysRepo(getDb()).listByProject({ organizationId: ctx.organizationId, projectId });
    return NextResponse.json({ keys });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const ctx = getRequestContext(request.headers);
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    await assertProject(ctx.organizationId, projectId);

    const apiKey = generateProjectApiKey();
    const key = await createProjectApiKeysRepo(getDb()).create({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      projectId,
      name: body.name?.trim() || "Default",
      keyHash: hashProjectApiKey(apiKey),
      ...projectApiKeyMetadata(apiKey),
      createdBy: ctx.userId,
    });
    if (!key) throw new Error("Failed to create API key");

    return NextResponse.json({ apiKey, key });
  } catch (error) {
    return errorResponse(error);
  }
}

async function assertProject(organizationId: string, projectId: string) {
  const project = await createProjectsRepo(getDb()).findById(organizationId, projectId);
  if (!project) throw new BadRequestError("project not found");
  return project;
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
