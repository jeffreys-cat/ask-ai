import { betterAuth } from "better-auth";
import { loadEnv } from "./load-env";

loadEnv();

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-change-me-dev-only-change-me-000000",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
  },
});
