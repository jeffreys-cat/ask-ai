import { and, desc, eq } from "drizzle-orm";
import type { JsonObject, ProjectStatus } from "@selectdb/shared";
import type { DbClient } from "../client";
import { projects } from "../schema";

export interface CreateProjectInput {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  metadata?: JsonObject;
  createdBy: string;
}

export function createProjectsRepo(db: DbClient) {
  return {
    async create(input: CreateProjectInput) {
      const [project] = await db.insert(projects).values(input).returning();
      return project;
    },

    async list(organizationId: string) {
      return db
        .select()
        .from(projects)
        .where(eq(projects.organizationId, organizationId))
        .orderBy(desc(projects.updatedAt));
    },

    async findById(organizationId: string, projectId: string) {
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
        .limit(1);
      return project ?? null;
    },

    async updateStatus(organizationId: string, projectId: string, status: ProjectStatus) {
      const [project] = await db
        .update(projects)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
        .returning();
      return project ?? null;
    },
  };
}
