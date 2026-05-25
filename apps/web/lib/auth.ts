import { auth, getRequestContextFromHeaders } from "@selectdb/auth";
import { UnauthorizedError, type RequestContext } from "@selectdb/shared";

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
    organizationId: getOrganizationId(headers),
  };
}

export async function getPublicRequestContext(headers: Headers): Promise<RequestContext> {
  const session = await getAuthSession(headers);
  if (session?.user) {
    return {
      userId: session.user.id,
      organizationId: getOrganizationId(headers),
    };
  }

  return getRequestContextFromHeaders(headers);
}

function getOrganizationId(headers: Headers) {
  return headers.get("x-organization-id") ?? process.env.INIT_ORGANIZATION_ID ?? process.env.DEV_ORGANIZATION_ID ?? "dev-org";
}
