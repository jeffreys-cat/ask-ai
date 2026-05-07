import type { JsonObject } from "@selectdb/shared";
import type { DbClient } from "../client";
import { feedback } from "../schema";

export function createFeedbackRepo(db: DbClient) {
  return {
    async create(input: {
      id: string;
      organizationId: string;
      askSessionId: string;
      rating: "up" | "down";
      comment?: string | null;
      metadata?: JsonObject;
      createdBy: string;
    }) {
      const [row] = await db.insert(feedback).values(input).returning();
      return row;
    },
  };
}
