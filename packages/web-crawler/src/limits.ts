export interface WebCrawlLimits {
  maxPages?: number;
  maxDepth?: number;
  maxPageBytes?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
}

export interface WebFetchLimits {
  maxPageBytes?: number;
  timeoutMs?: number;
}

export const DEFAULT_WEB_CRAWL_LIMITS = {
  maxPages: 100,
  maxDepth: 3,
  maxPageBytes: 5 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  timeoutMs: 15_000,
} satisfies Required<WebCrawlLimits>;

export function withCrawlDefaults(limits: WebCrawlLimits = {}) {
  return { ...DEFAULT_WEB_CRAWL_LIMITS, ...limits };
}

export function withFetchDefaults(limits: WebFetchLimits = {}) {
  return {
    maxPageBytes: limits.maxPageBytes ?? DEFAULT_WEB_CRAWL_LIMITS.maxPageBytes,
    timeoutMs: limits.timeoutMs ?? DEFAULT_WEB_CRAWL_LIMITS.timeoutMs,
  };
}
