import type { RequestContext } from "@selectdb/shared";

export function assertSameOrganization(ctx: RequestContext, organizationId: string) {
  if (ctx.organizationId !== organizationId) {
    throw new Error("Organization scope mismatch");
  }
}
