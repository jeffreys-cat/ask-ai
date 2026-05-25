import { createAskRepo } from "@selectdb/db";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { getRequestContext } from "../../../../lib/auth";
import { getDb } from "../../../../lib/runtime";

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext(request.headers);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || undefined;
    const limit = Number(url.searchParams.get("limit") || "50");
    const askRepo = createAskRepo(getDb());
    const sessions = await askRepo.listSessions({
      organizationId: ctx.organizationId,
      projectId,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    });

    return Response.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        userId: session.userId,
        question: session.question,
        answer: session.answer,
        citations: session.citations,
        metadata: session.metadata,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
  return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
}
