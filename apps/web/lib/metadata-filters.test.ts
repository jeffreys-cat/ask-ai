import { describe, expect, it } from "vitest";
import { BadRequestError } from "@selectdb/shared";
import { parseMetadataFilters } from "./metadata-filters";

describe("parseMetadataFilters", () => {
  it("normalizes supported filter fields and date-only bounds", () => {
    expect(
      parseMetadataFilters({
        version: ["3.0", " 3.1 "],
        language: "zh-CN",
        productLine: "cloud",
        publishedAt: { from: "2026-01-01", to: "2026-05-28" },
      }),
    ).toEqual({
      version: ["3.0", "3.1"],
      language: "zh-CN",
      productLine: "cloud",
      publishedAt: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-05-28T23:59:59.999Z",
      },
    });
  });

  it("rejects invalid filter shapes", () => {
    expect(() => parseMetadataFilters({ version: 3 })).toThrow(BadRequestError);
    expect(() => parseMetadataFilters({ publishedAt: { from: "not-a-date" } })).toThrow(BadRequestError);
  });
});
