import { asc, eq } from "drizzle-orm";
import { member, organization, user, type DbClient } from "@selectdb/db";
import type { User } from "better-auth";

export type DefaultOrganization = {
  id: string;
  name: string;
  slug: string;
};

export async function ensureDefaultOrganizationForUser(db: DbClient, authUser: Pick<User, "id" | "name" | "email">) {
  const [existingMembership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, authUser.id))
    .orderBy(asc(member.createdAt))
    .limit(1);

  if (existingMembership) return existingMembership.organizationId;

  const defaultOrganization = getDefaultOrganizationForUser(authUser);
  await ensureOrganization(db, defaultOrganization);
  await ensureOwnerMembership(db, authUser.id, defaultOrganization.id);

  return defaultOrganization.id;
}

export async function ensureDefaultOrganizationForUserId(db: DbClient, userId: string) {
  const [authUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!authUser) return null;

  return ensureDefaultOrganizationForUser(db, authUser);
}

export function getDefaultOrganizationForUser(authUser: Pick<User, "id" | "name" | "email">): DefaultOrganization {
  const initOrganization = getInitOrganizationForUser(authUser);
  if (initOrganization) return initOrganization;

  const id = crypto.randomUUID();
  const name = defaultOrganizationName(authUser);
  return {
    id,
    name,
    slug: `${slugFromId(name)}-${slugFromId(authUser.id) || slugFromId(id)}`,
  };
}

function getInitOrganizationForUser(authUser: Pick<User, "id" | "name" | "email">): DefaultOrganization | null {
  const initEmail = process.env.INIT_USER_EMAIL?.trim().toLowerCase();
  if (!initEmail || authUser.email.trim().toLowerCase() !== initEmail) return null;

  const id = process.env.INIT_ORGANIZATION_ID?.trim() || process.env.DEV_ORGANIZATION_ID?.trim() || "dev-org";
  return {
    id,
    name: process.env.INIT_ORGANIZATION_NAME?.trim() || titleFromId(id),
    slug: process.env.INIT_ORGANIZATION_SLUG?.trim() || slugFromId(id),
  };
}

async function ensureOrganization(db: DbClient, defaultOrganization: DefaultOrganization) {
  const [existingOrg] = await db.select().from(organization).where(eq(organization.id, defaultOrganization.id)).limit(1);
  if (existingOrg) return;

  await db.insert(organization).values(defaultOrganization);
}

async function ensureOwnerMembership(db: DbClient, userId: string, organizationId: string) {
  const memberId = `${organizationId}:${userId}`;
  const [existingMember] = await db.select().from(member).where(eq(member.id, memberId)).limit(1);
  if (existingMember) return;

  await db.insert(member).values({
    id: memberId,
    organizationId,
    userId,
    role: "owner",
  });
}

function defaultOrganizationName(authUser: Pick<User, "id" | "name" | "email">) {
  const ownerName = authUser.name.trim() || authUser.email.split("@")[0]?.trim() || authUser.id;
  return `${ownerName}'s Organization`;
}

function titleFromId(id: string) {
  return (
    id
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Default Organization"
  );
}

function slugFromId(id: string) {
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}
