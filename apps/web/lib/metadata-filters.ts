import { BadRequestError, type MetadataFilters } from "@selectdb/shared";

export function parseMetadataFilters(input: unknown): MetadataFilters | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isObject(input)) throw new BadRequestError("filters must be an object");

  const filters: MetadataFilters = {};
  const version = parseStringFilter(input.version, "filters.version");
  const language = parseStringFilter(input.language, "filters.language");
  const productLine = parseStringFilter(input.productLine, "filters.productLine");
  const publishedAt = parsePublishedAtFilter(input.publishedAt);

  if (version) filters.version = version;
  if (language) filters.language = language;
  if (productLine) filters.productLine = productLine;
  if (publishedAt) filters.publishedAt = publishedAt;

  return hasFilters(filters) ? filters : undefined;
}

function parseStringFilter(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return normalizeString(value, field);
  if (Array.isArray(value)) {
    const values = value.map((item) => normalizeString(item, field)).filter(Boolean);
    return values.length === 0 ? undefined : values;
  }
  throw new BadRequestError(`${field} must be a string or string array`);
}

function parsePublishedAtFilter(value: unknown): MetadataFilters["publishedAt"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new BadRequestError("filters.publishedAt must be an object");

  const from = parseDateBound(value.from, "filters.publishedAt.from", "from");
  const to = parseDateBound(value.to, "filters.publishedAt.to", "to");
  if (!from && !to) return undefined;
  return { from, to };
}

function normalizeString(value: unknown, field: string) {
  if (typeof value !== "string") throw new BadRequestError(`${field} must contain only strings`);
  return value.trim();
}

function parseDateBound(value: unknown, field: string, bound: "from" | "to") {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestError(`${field} must be a string`);
  const trimmed = value.trim();
  const date = dateOnlyPattern.test(trimmed)
    ? new Date(`${trimmed}T${bound === "from" ? "00:00:00.000" : "23:59:59.999"}Z`)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return date.toISOString();
}

function hasFilters(filters: MetadataFilters) {
  return Boolean(filters.version || filters.language || filters.productLine || filters.publishedAt?.from || filters.publishedAt?.to);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
