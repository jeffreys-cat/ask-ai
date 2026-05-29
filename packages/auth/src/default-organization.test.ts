import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultOrganizationForUser } from "./default-organization";

describe("getDefaultOrganizationForUser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a per-user default organization", () => {
    const defaultOrganization = getDefaultOrganizationForUser({
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });

    expect(defaultOrganization.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(defaultOrganization.name).toBe("Ada Lovelace's Organization");
    expect(defaultOrganization.slug).toBe("ada-lovelace-s-organization-user-123");
  });

  it("uses the configured init organization for the init user", () => {
    vi.stubEnv("INIT_USER_EMAIL", "admin@example.com");
    vi.stubEnv("INIT_ORGANIZATION_ID", "primary-org");
    vi.stubEnv("INIT_ORGANIZATION_NAME", "Primary Organization");
    vi.stubEnv("INIT_ORGANIZATION_SLUG", "primary");

    const defaultOrganization = getDefaultOrganizationForUser({
      id: "admin-user",
      name: "Admin",
      email: "ADMIN@example.com",
    });

    expect(defaultOrganization).toEqual({
      id: "primary-org",
      name: "Primary Organization",
      slug: "primary",
    });
  });
});
