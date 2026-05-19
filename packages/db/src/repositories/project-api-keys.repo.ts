import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../client";
import { projectApiKeys } from "../schema";

export interface CreateProjectApiKeyInput {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  keyLast4: string;
  createdBy: string;
}

export function createProjectApiKeysRepo(db: DbClient) {
  return {
    async create(input: CreateProjectApiKeyInput) {
      const [key] = await db.insert(projectApiKeys).values(input).returning(publicKeyColumns);
      return key ?? null;
    },

    async listByProject(input: { organizationId: string; projectId: string }) {
      return db
        .select(publicKeyColumns)
        .from(projectApiKeys)
        .where(and(eq(projectApiKeys.organizationId, input.organizationId), eq(projectApiKeys.projectId, input.projectId)))
        .orderBy(desc(projectApiKeys.createdAt));
    },

    async findActiveByHash(keyHash: string) {
      const [key] = await db
        .select()
        .from(projectApiKeys)
        .where(and(eq(projectApiKeys.keyHash, keyHash), isNull(projectApiKeys.revokedAt)))
        .limit(1);
      return key ?? null;
    },

    async touchLastUsed(keyId: string) {
      await db.update(projectApiKeys).set({ lastUsedAt: new Date() }).where(eq(projectApiKeys.id, keyId));
    },

    async revoke(input: { organizationId: string; projectId: string; keyId: string }) {
      const [key] = await db
        .update(projectApiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(projectApiKeys.organizationId, input.organizationId),
            eq(projectApiKeys.projectId, input.projectId),
            eq(projectApiKeys.id, input.keyId),
            isNull(projectApiKeys.revokedAt),
          ),
        )
        .returning(publicKeyColumns);
      return key ?? null;
    },
  };
}

const publicKeyColumns = {
  id: projectApiKeys.id,
  organizationId: projectApiKeys.organizationId,
  projectId: projectApiKeys.projectId,
  name: projectApiKeys.name,
  keyPrefix: projectApiKeys.keyPrefix,
  keyLast4: projectApiKeys.keyLast4,
  createdBy: projectApiKeys.createdBy,
  createdAt: projectApiKeys.createdAt,
  lastUsedAt: projectApiKeys.lastUsedAt,
  revokedAt: projectApiKeys.revokedAt,
};
