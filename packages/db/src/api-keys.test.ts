import { describe, expect, it } from "vitest";
import {
  generateProjectApiKey,
  hashProjectApiKey,
  isProjectApiKey,
  projectApiKeyMetadata,
  verifyProjectApiKey,
} from "./api-keys";

describe("project API keys", () => {
  it("generates ask-ai keys with the askai prefix", () => {
    const apiKey = generateProjectApiKey();

    expect(apiKey).toMatch(/^askai_[A-Za-z0-9_-]+$/);
    expect(isProjectApiKey(apiKey)).toBe(true);
  });

  it("verifies the original key and rejects a different key", () => {
    const apiKey = generateProjectApiKey();
    const keyHash = hashProjectApiKey(apiKey);

    expect(verifyProjectApiKey(apiKey, keyHash)).toBe(true);
    expect(verifyProjectApiKey(generateProjectApiKey(), keyHash)).toBe(false);
  });

  it("returns key metadata without the full key", () => {
    const apiKey = generateProjectApiKey();
    const metadata = projectApiKeyMetadata(apiKey);

    expect(metadata.keyPrefix).toBe("askai");
    expect(metadata.keyLast4).toBe(apiKey.slice(-4));
    expect(JSON.stringify(metadata)).not.toContain(apiKey);
  });
});
