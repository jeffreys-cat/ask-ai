import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { account, createDb, member, organization, session, user, verification } from "@selectdb/db";
import { loadEnv } from "./load-env";

loadEnv();

let db: ReturnType<typeof createDb> | undefined;
let initUserPromise: Promise<void> | undefined;

function getAuthDb() {
  db ??= createDb();
  return db;
}

const socialProviders = {
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
};

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-change-me-dev-only-change-me-000000",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(getAuthDb(), {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
});

export function ensureInitUser() {
  initUserPromise ??= createInitUser().catch((error) => {
    initUserPromise = undefined;
    throw error;
  });
  return initUserPromise;
}

async function createInitUser() {
  const email = process.env.INIT_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.INIT_USER_PASSWORD;
  if (!email && !password) return;
  if (!email || !password) {
    throw new Error("INIT_USER_EMAIL and INIT_USER_PASSWORD must be configured together");
  }
  if (password.length < 8) {
    throw new Error("INIT_USER_PASSWORD must be at least 8 characters");
  }

  const initDb = getAuthDb();
  const [existingUser] = await initDb.select().from(user).where(eq(user.email, email)).limit(1);
  let userId = existingUser?.id;

  if (!userId) {
    userId = (
      await auth.api.signUpEmail({
        body: {
          name: process.env.INIT_USER_NAME?.trim() || email.split("@")[0] || email,
          email,
          password,
          rememberMe: false,
        },
      })
    ).user.id;
  }

  if (!existingUser?.emailVerified) {
    await initDb.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, userId));
  }

  const organizationId = process.env.INIT_ORGANIZATION_ID?.trim() || process.env.DEV_ORGANIZATION_ID?.trim() || "dev-org";
  const organizationName = process.env.INIT_ORGANIZATION_NAME?.trim() || titleFromId(organizationId);
  const organizationSlug = process.env.INIT_ORGANIZATION_SLUG?.trim() || slugFromId(organizationId);

  const [existingOrg] = await initDb.select().from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!existingOrg) {
    await initDb.insert(organization).values({
      id: organizationId,
      name: organizationName,
      slug: organizationSlug,
    });
  }

  const memberId = `${organizationId}:${userId}`;
  const [existingMember] = await initDb.select().from(member).where(eq(member.id, memberId)).limit(1);
  if (!existingMember) {
    await initDb.insert(member).values({
      id: memberId,
      organizationId,
      userId,
      role: "owner",
    });
  }
}

function titleFromId(id: string) {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Default Organization";
}

function slugFromId(id: string) {
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}
