import { assertPublicHttpUrl } from "./network";
import { type WebFetchLimits, withFetchDefaults } from "./limits";

export interface FetchWebDocumentOptions extends WebFetchLimits {
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

export interface FetchedWebDocument {
  url: string;
  finalUrl: string;
  content: string;
  mimeType: string;
  size: number;
}

export async function fetchWebDocument(url: string, options: FetchWebDocumentOptions = {}): Promise<FetchedWebDocument> {
  const limits = withFetchDefaults(options);
  const publicUrl = await assertPublicHttpUrl(url, { resolveHostname: options.resolveHostname });
  const { response, finalUrl: fetchedUrl } = await fetchWithTimeout(
    publicUrl.toString(),
    limits.timeoutMs,
    options.fetchImpl,
    options.resolveHostname,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ${publicUrl.toString()}: HTTP ${response.status}`);
  }

  const finalUrl = await assertPublicHttpUrl(response.url || fetchedUrl, { resolveHostname: options.resolveHostname });
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "text/html";
  if (!mimeType.includes("html")) {
    throw new Error(`Unsupported web content type: ${mimeType}`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > limits.maxPageBytes) {
    throw new Error(`Web document exceeds ${limits.maxPageBytes} byte limit`);
  }

  const { content, size } = await readResponseText(response, limits.maxPageBytes);
  return {
    url: publicUrl.toString(),
    finalUrl: finalUrl.toString(),
    content,
    mimeType,
    size,
  };
}

export async function fetchTextResource(url: string, options: FetchWebDocumentOptions = {}) {
  const limits = withFetchDefaults(options);
  const publicUrl = await assertPublicHttpUrl(url, { resolveHostname: options.resolveHostname });
  const { response, finalUrl: fetchedUrl } = await fetchWithTimeout(
    publicUrl.toString(),
    limits.timeoutMs,
    options.fetchImpl,
    options.resolveHostname,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${publicUrl.toString()}: HTTP ${response.status}`);
  }
  const finalUrl = await assertPublicHttpUrl(response.url || fetchedUrl, { resolveHostname: options.resolveHostname });
  const { content, size } = await readResponseText(response, limits.maxPageBytes);
  return { url: publicUrl.toString(), finalUrl: finalUrl.toString(), content, size };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  resolveHostname?: (hostname: string) => Promise<string[]>,
) {
  let currentUrl = url;
  const maxRedirects = 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchOnce(currentUrl, timeoutMs, fetchImpl);
    if (!isRedirect(response.status)) return { response, finalUrl: currentUrl };

    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect from ${currentUrl} is missing a location header`);
    const nextUrl = new URL(location, currentUrl).toString();
    await assertPublicHttpUrl(nextUrl, { resolveHostname });
    currentUrl = nextUrl;
  }

  throw new Error(`Too many redirects while fetching ${url}`);
}

async function fetchOnce(url: string, timeoutMs: number, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "selectdb-web-crawler/0.0.0",
        accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

async function readResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    const content = await response.text();
    const size = Buffer.byteLength(content, "utf8");
    if (size > maxBytes) throw new Error(`Web document exceeds ${maxBytes} byte limit`);
    return { content, size };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Web document exceeds ${maxBytes} byte limit`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { content: new TextDecoder().decode(concatBytes(chunks, size)), size };
}

function concatBytes(chunks: Uint8Array[], size: number) {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
