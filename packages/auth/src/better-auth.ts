import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { account, createDb, session, user, verification } from "@selectdb/db";
import { ensureDefaultOrganizationForUser, ensureDefaultOrganizationForUserId } from "./default-organization";
import { loadEnv } from "./load-env";

loadEnv();

let db: ReturnType<typeof createDb> | undefined;
let authInstance: ReturnType<typeof createAuth> | undefined;
let initUserPromise: Promise<void> | undefined;

function getAuthDb() {
  db ??= createDb();
  return db;
}

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}

function createAuth() {
  return betterAuth({
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
    socialProviders: getSocialProviders(),
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            await ensureDefaultOrganizationForUser(getAuthDb(), createdUser);
          },
        },
      },
      session: {
        create: {
          after: async (createdSession) => {
            await ensureDefaultOrganizationForUserId(getAuthDb(), createdSession.userId);
          },
        },
      },
    },
  });
}

function getSocialProviders() {
  return {
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
}

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
      await getAuth().api.signUpEmail({
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

  await ensureDefaultOrganizationForUser(initDb, {
    id: userId,
    name: process.env.INIT_USER_NAME?.trim() || email.split("@")[0] || email,
    email,
  });
}
