import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PROJECT_API_KEY_PREFIX = "askai";

export function generateProjectApiKey() {
  return `${PROJECT_API_KEY_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

export function hashProjectApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function verifyProjectApiKey(apiKey: string, keyHash: string) {
  const actual = Buffer.from(hashProjectApiKey(apiKey), "hex");
  const expected = Buffer.from(keyHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function projectApiKeyMetadata(apiKey: string) {
  return {
    keyPrefix: PROJECT_API_KEY_PREFIX,
    keyLast4: apiKey.slice(-4),
  };
}

export function isProjectApiKey(value: string) {
  return value.startsWith(`${PROJECT_API_KEY_PREFIX}_`);
}
