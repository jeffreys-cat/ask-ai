import { describe, expect, it, vi } from "vitest";
import { fetchWebDocument } from "./web-document";

const publicResolver = async () => ["93.184.216.34"];

describe("fetchWebDocument", () => {
  it("fetches HTML and returns document metadata", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const body = "<html><body>Docs</body></html>";
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(body)) },
      }) as Response & { url: string };
    });

    await expect(
      fetchWebDocument("https://example.com/docs", { fetchImpl: fetchImpl as typeof fetch, resolveHostname: publicResolver }),
    ).resolves.toMatchObject({
      url: "https://example.com/docs",
      finalUrl: "https://example.com/docs",
      content: "<html><body>Docs</body></html>",
      mimeType: "text/html",
    });
  });

  it("rejects non-html content", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

    await expect(
      fetchWebDocument("https://example.com/api", { fetchImpl: fetchImpl as typeof fetch, resolveHostname: publicResolver }),
    ).rejects.toThrow("Unsupported web content type");
  });

  it("checks each redirect target before fetching it", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://localhost/private" } }));

    await expect(
      fetchWebDocument("https://example.com/docs", { fetchImpl: fetchImpl as typeof fetch, resolveHostname: publicResolver }),
    ).rejects.toThrow("Private and localhost URLs are not allowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects documents over the page byte limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("too large", { status: 200, headers: { "content-type": "text/html" } }));

    await expect(
      fetchWebDocument("https://example.com/large", {
        fetchImpl: fetchImpl as typeof fetch,
        resolveHostname: publicResolver,
        maxPageBytes: 3,
      }),
    ).rejects.toThrow("byte limit");
  });
});
