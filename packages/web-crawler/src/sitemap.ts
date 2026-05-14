import { type WebCrawlLimits, withCrawlDefaults } from "./limits";
import { assertPublicHttpUrl } from "./network";
import { fetchTextResource, type FetchWebDocumentOptions } from "./web-document";

export interface DiscoveredUrl {
  url: string;
  sitemapUrl: string;
  lastmod?: string;
}

export interface DiscoverSitemapUrlsOptions extends WebCrawlLimits {
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

export async function discoverSitemapUrls(inputUrl: string, options: DiscoverSitemapUrlsOptions = {}): Promise<DiscoveredUrl[]> {
  const limits = withCrawlDefaults(options);
  const normalizedInput = await assertPublicHttpUrl(inputUrl, { resolveHostname: options.resolveHostname });
  const sitemapUrl = sitemapUrlForInput(normalizedInput);
  const visitedSitemaps = new Set<string>();
  const discovered: DiscoveredUrl[] = [];
  let totalBytes = 0;

  async function visitSitemap(url: string, depth: number): Promise<void> {
    if (depth > limits.maxDepth || visitedSitemaps.has(url) || discovered.length >= limits.maxPages) return;
    visitedSitemaps.add(url);

    const sitemap = await fetchTextResource(url, fetchOptions(options, limits));
    totalBytes += sitemap.size;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`Sitemap discovery exceeds ${limits.maxTotalBytes} byte limit`);
    }

    const entries = parseSitemap(sitemap.content);
    for (const entry of entries.sitemaps) {
      const childUrl = sameOriginUrl(entry.loc, normalizedInput);
      if (childUrl) await visitSitemap(childUrl.toString(), depth + 1);
      if (discovered.length >= limits.maxPages) return;
    }

    for (const entry of entries.urls) {
      const pageUrl = sameOriginUrl(entry.loc, normalizedInput);
      if (!pageUrl) continue;
      discovered.push({ url: pageUrl.toString(), sitemapUrl: sitemap.finalUrl, lastmod: entry.lastmod });
      if (discovered.length >= limits.maxPages) return;
    }
  }

  await visitSitemap(sitemapUrl.toString(), 0);

  const preferred = discovered.filter((entry) => isUnderInputPath(entry.url, normalizedInput));
  const selected = preferred.length > 0 ? preferred : discovered;
  return dedupeDiscoveredUrls(selected).slice(0, limits.maxPages);
}

export function parseSitemap(xml: string) {
  const sitemaps = extractBlocks(xml, "sitemap").flatMap((block) => {
    const loc = firstTagValue(block, "loc");
    return loc ? [{ loc }] : [];
  });
  const urls = extractBlocks(xml, "url").flatMap((block) => {
    const loc = firstTagValue(block, "loc");
    if (!loc) return [];
    return [{ loc, lastmod: firstTagValue(block, "lastmod") }];
  });
  return { sitemaps, urls };
}

function sitemapUrlForInput(inputUrl: URL) {
  if (inputUrl.pathname.toLowerCase().endsWith(".xml")) return inputUrl;
  return new URL("/sitemap.xml", inputUrl.origin);
}

function sameOriginUrl(rawUrl: string, originUrl: URL) {
  try {
    const url = new URL(rawUrl, originUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== originUrl.origin) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isUnderInputPath(rawUrl: string, inputUrl: URL) {
  if (inputUrl.pathname === "/" || inputUrl.pathname.toLowerCase().endsWith(".xml")) return true;
  const pageUrl = new URL(rawUrl);
  const inputPath = inputUrl.pathname.endsWith("/") ? inputUrl.pathname : `${inputUrl.pathname}/`;
  return pageUrl.pathname === inputUrl.pathname || pageUrl.pathname.startsWith(inputPath);
}

function dedupeDiscoveredUrls(urls: DiscoveredUrl[]) {
  const seen = new Set<string>();
  const deduped: DiscoveredUrl[] = [];
  for (const entry of urls) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    deduped.push(entry);
  }
  return deduped;
}

function fetchOptions(options: DiscoverSitemapUrlsOptions, limits: Required<WebCrawlLimits>): FetchWebDocumentOptions {
  return {
    fetchImpl: options.fetchImpl,
    resolveHostname: options.resolveHostname,
    maxPageBytes: limits.maxPageBytes,
    timeoutMs: limits.timeoutMs,
  };
}

function extractBlocks(xml: string, tagName: string) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "gi");
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? "");
}

function firstTagValue(xml: string, tagName: string) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i");
  const value = xml.match(pattern)?.[1]?.trim();
  return value ? decodeXmlEntities(value) : undefined;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
