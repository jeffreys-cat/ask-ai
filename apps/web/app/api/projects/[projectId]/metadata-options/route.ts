import { NextResponse } from "next/server";
import { createDocumentsRepo, createProjectsRepo } from "@selectdb/db";
import { assertSqlIdentifier } from "@selectdb/doris";
import { BadRequestError, UnauthorizedError } from "@selectdb/shared";
import { getRequestContext } from "../../../../../lib/auth";
import { getDb, getDoris } from "../../../../../lib/runtime";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

type MetadataOptionField = "version" | "language" | "productLine";

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const ctx = await getRequestContext(request.headers);
    const db = getDb();
    const project = await createProjectsRepo(db).findById(ctx.organizationId, projectId);
    if (!project) throw new BadRequestError("project not found");

    const documents = await createDocumentsRepo(db).listReadyByProject(ctx.organizationId, projectId);
    const documentIds = documents.map((document) => document.id);
    if (documentIds.length === 0) {
      return NextResponse.json({ versions: [], languages: [], productLines: [] });
    }

    const table = assertSqlIdentifier(process.env.DORIS_CHUNKS_TABLE ?? "document_chunks");
    const [versions, languages, productLines] = await Promise.all([
      distinctMetadataValues({ table, organizationId: ctx.organizationId, documentIds, field: "version" }),
      distinctMetadataValues({ table, organizationId: ctx.organizationId, documentIds, field: "language" }),
      distinctMetadataValues({ table, organizationId: ctx.organizationId, documentIds, field: "productLine" }),
    ]);

    return NextResponse.json({ versions, languages, productLines });
  } catch (error) {
    const status = error instanceof BadRequestError || error instanceof UnauthorizedError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}

async function distinctMetadataValues(input: {
  table: string;
  organizationId: string;
  documentIds: string[];
  field: MetadataOptionField;
}) {
  const expression = `JSON_EXTRACT_STRING(metadata, '$.${input.field}')`;
  const [rows] = await getDoris().execute(
    `SELECT DISTINCT ${expression} AS value
     FROM ${input.table}
     WHERE organization_id = ?
       AND document_id IN (${input.documentIds.map(() => "?").join(",")})
       AND ${expression} IS NOT NULL
       AND ${expression} != ''
     ORDER BY value
     LIMIT 100`,
    [input.organizationId, ...input.documentIds],
  );

  return (rows as Array<{ value?: unknown }>)
    .map((row) => (typeof row.value === "string" ? row.value.trim() : ""))
    .filter(Boolean);
}
