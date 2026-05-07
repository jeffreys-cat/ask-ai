import * as cheerio from "cheerio";
import { splitTextIntoChunks, type SplitOptions } from "./splitter";

export function chunkHtml(html: string, options: SplitOptions) {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $("body").text() || $.text();
  const normalized = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return splitTextIntoChunks(normalized, { ...options, metadata: { ...(options.metadata ?? {}), parser: "html" } });
}
