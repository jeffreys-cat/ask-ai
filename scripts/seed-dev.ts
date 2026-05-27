import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { account, createDb, member, organization, user } from "@selectdb/db";
import { and, eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const db = createDb();
  try {
    const userId = process.env.DEV_USER_ID ?? "dev-user";
    const userEmail = process.env.DEV_USER_EMAIL?.trim().toLowerCase() || "dev@example.com";
    const userPassword = process.env.DEV_USER_PASSWORD ?? "dev-password";
    const organizationId = process.env.DEV_ORGANIZATION_ID ?? "dev-org";
    if (userPassword.length < 8) throw new Error("DEV_USER_PASSWORD must be at least 8 characters");

    const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!existingUser) {
      await db.insert(user).values({
        id: userId,
        name: "Dev User",
        email: userEmail,
        emailVerified: true,
      });
    }
    await upsertCredentialAccount(db, userId, userPassword);

    const [existingOrg] = await db.select().from(organization).where(eq(organization.id, organizationId)).limit(1);
    if (!existingOrg) {
      await db.insert(organization).values({
        id: organizationId,
        name: "Dev Organization",
        slug: "dev",
      });
    }

    const [existingMember] = await db
      .select()
      .from(member)
      .where(eq(member.id, `${organizationId}:${userId}`))
      .limit(1);

    if (!existingMember) {
      await db.insert(member).values({
        id: `${organizationId}:${userId}`,
        organizationId,
        userId,
        role: "owner",
      });
    }

    console.log(`Seeded ${userEmail} in ${organizationId}`);
  } finally {
    await db.end({ timeout: 1 });
  }
}

async function upsertCredentialAccount(db: ReturnType<typeof createDb>, userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [existingAccount] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);

  if (existingAccount) {
    await db
      .update(account)
      .set({ accountId: userId, password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, existingAccount.id));
    return;
  }

  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: passwordHash,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
