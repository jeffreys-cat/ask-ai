import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  const rootEnvLocal = resolve(process.cwd(), "../../.env.local");
  if (existsSync(rootEnvLocal)) {
    config({ path: rootEnvLocal, quiet: true });
  }

  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  config({ quiet: true });
}
