import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env.local", quiet: true });
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
