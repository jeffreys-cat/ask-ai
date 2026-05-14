import { describe, expect, it, vi } from "vitest";
import { discoverSitemapUrls, parseSitemap } from "./sitemap";

const publicResolver = async () => ["93.184.216.34"];

describe("parseSitemap", () => {
  it("extracts sitemap indexes and url entries", () => {
    expect(
      parseSitemap(`<?xml version="1.0"?>
        <sitemapindex>
          <sitemap><loc>https://example.com/docs.xml</loc></sitemap>
        </sitemapindex>
        <urlset>
          <url><loc>https://example.com/docs/a?x=1&amp;y=2</loc><lastmod>2026-01-01</lastmod></url>
        </urlset>`),
    ).toEqual({
      sitemaps: [{ loc: "https://example.com/docs.xml" }],
      urls: [{ loc: "https://example.com/docs/a?x=1&y=2", lastmod: "2026-01-01" }],
    });
  });
});

describe("discoverSitemapUrls", () => {
  it("recurses through sitemap indexes, filters same-origin urls, and prefers the input path", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml") {
        return response(`<sitemapindex><sitemap><loc>https://example.com/docs.xml</loc></sitemap></sitemapindex>`, url);
      }
      return response(
        `<urlset>
          <url><loc>https://example.com/docs/a</loc></url>
          <url><loc>https://example.com/blog/b</loc></url>
          <url><loc>https://other.example.com/docs/c</loc></url>
        </urlset>`,
        url,
      );
    });

    await expect(
      discoverSitemapUrls("https://example.com/docs", { fetchImpl: fetchImpl as typeof fetch, resolveHostname: publicResolver }),
    ).resolves.toEqual([{ url: "https://example.com/docs/a", sitemapUrl: "https://example.com/docs.xml", lastmod: undefined }]);
  });

  it("treats xml input as the sitemap url and applies max page limits", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      response(
        `<urlset>
          <url><loc>https://example.com/a</loc></url>
          <url><loc>https://example.com/b</loc></url>
        </urlset>`,
        url,
      ),
    );

    const urls = await discoverSitemapUrls("https://example.com/custom.xml", {
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: publicResolver,
      maxPages: 1,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/custom.xml", expect.any(Object));
    expect(urls).toHaveLength(1);
  });

  it("rejects private URLs before fetching", async () => {
    await expect(discoverSitemapUrls("http://localhost:3000/docs")).rejects.toThrow("Private and localhost URLs are not allowed");
  });
});

function response(body: string, url: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) },
  }) as Response & { url: string };
}
