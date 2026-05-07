import { config } from "dotenv";
import { createDb, member, organization, user } from "@selectdb/db";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const db = createDb();
  try {
    const userId = process.env.DEV_USER_ID ?? "dev-user";
    const organizationId = process.env.DEV_ORGANIZATION_ID ?? "dev-org";

    const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!existingUser) {
      await db.insert(user).values({
        id: userId,
        name: "Dev User",
        email: "dev@example.com",
        emailVerified: true,
      });
    }

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

    console.log(`Seeded ${userId} in ${organizationId}`);
  } finally {
    await db.end({ timeout: 1 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
