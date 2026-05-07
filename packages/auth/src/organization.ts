import type { RequestContext } from "@selectdb/shared";

export function getOrganizationIdFromHeaders(headers: Headers) {
  return headers.get("x-organization-id") ?? process.env.DEV_ORGANIZATION_ID ?? "dev-org";
}

export function getUserIdFromHeaders(headers: Headers) {
  return headers.get("x-user-id") ?? process.env.DEV_USER_ID ?? "dev-user";
}

export function getRequestContextFromHeaders(headers: Headers): RequestContext {
  return {
    userId: getUserIdFromHeaders(headers),
    organizationId: getOrganizationIdFromHeaders(headers),
  };
}
