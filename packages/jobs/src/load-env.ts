import { config } from "dotenv";

export function loadRootEnv() {
  config({ path: "../../.env.local", quiet: true });
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
}
