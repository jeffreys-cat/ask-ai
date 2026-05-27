import { auth, getRequestContextFromHeaders } from "@selectdb/auth";
import { member } from "@selectdb/db";
import { UnauthorizedError, type RequestContext } from "@selectdb/shared";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./runtime";

export async function getAuthSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

export async function getRequestContext(headers: Headers): Promise<RequestContext> {
  const session = await getAuthSession(headers);
  if (!session?.user) {
    throw new UnauthorizedError();
  }

  return {
    userId: session.user.id,
    organizationId: await resolveOrganizationIdForUser(session.user.id, headers),
  };
}

export async function getPublicRequestContext(headers: Headers): Promise<RequestContext> {
  const session = await getAuthSession(headers);
  if (session?.user) {
    return {
      userId: session.user.id,
      organizationId: await resolveOrganizationIdForUser(session.user.id, headers),
    };
  }

  return getRequestContextFromHeaders(headers);
}

async function resolveOrganizationIdForUser(userId: string, headers: Headers) {
  const requestedOrganizationId = getRequestedOrganizationId(headers);
  if (requestedOrganizationId) {
    const membership = await findMembership(userId, requestedOrganizationId);
    if (!membership) throw new UnauthorizedError("Organization access denied");
    return membership.organizationId;
  }

  const defaultOrganizationId = getDefaultOrganizationId();
  const defaultMembership = defaultOrganizationId ? await findMembership(userId, defaultOrganizationId) : null;
  if (defaultMembership) return defaultMembership.organizationId;

  const [firstMembership] = await getDb()
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (firstMembership) return firstMembership.organizationId;

  throw new UnauthorizedError("User is not assigned to an organization");
}

async function findMembership(userId: string, organizationId: string) {
  const [membership] = await getDb()
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return membership ?? null;
}

function getRequestedOrganizationId(headers: Headers) {
  return headers.get("x-organization-id")?.trim() || null;
}

function getDefaultOrganizationId() {
  return process.env.INIT_ORGANIZATION_ID?.trim() || process.env.DEV_ORGANIZATION_ID?.trim() || null;
}
