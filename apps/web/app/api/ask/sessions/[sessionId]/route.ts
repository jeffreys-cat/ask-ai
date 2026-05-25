import { createAskRepo } from "@selectdb/db";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/runtime";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: Request, { params }: PageProps) {
  try {
    const ctx = await getRequestContext(request.headers);
    const { sessionId } = await params;
    const askRepo = createAskRepo(getDb());
    const session = await askRepo.findSession({ organizationId: ctx.organizationId, sessionId });

    if (!session) {
      return Response.json({ error: "session not found" }, { status: 404 });
    }

    const messages = await askRepo.listMessages({ sessionId });

    return Response.json({
      session: {
        id: session.id,
        userId: session.userId,
        question: session.question,
        answer: session.answer,
        citations: session.citations,
        metadata: session.metadata,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.createdAt.toISOString(),
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
