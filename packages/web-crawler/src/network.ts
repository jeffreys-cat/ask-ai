import { lookup } from "node:dns/promises";
import net from "node:net";

export async function assertPublicHttpUrl(rawUrl: string, options: { resolveHostname?: (hostname: string) => Promise<string[]> } = {}) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Private and localhost URLs are not allowed");
  }

  const addresses = await resolveAddresses(hostname, options.resolveHostname);
  if (addresses.length === 0) {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error("Private and localhost URLs are not allowed");
    }
  }

  return url;
}

async function resolveAddresses(hostname: string, resolveHostname?: (hostname: string) => Promise<string[]>) {
  if (resolveHostname) return resolveHostname(hostname);

  const literalVersion = net.isIP(hostname);
  if (literalVersion) return [hostname];

  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function isPrivateAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}
