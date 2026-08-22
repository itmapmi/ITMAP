import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; SpectioNewsDirect/1.0)";

export interface PublicTextResponse {
  url: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 192 && b === 88 && parts[2] === 99) ||
    (a === 198 && b === 18) ||
    (a === 198 && b === 19) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0].replace(/^\[|\]$/g, "");
  const groups = parseIpv6Groups(normalized);
  if (!groups) return true;

  if (groups.every((group) => group === 0) || (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)) return true;
  // Unique-local (fc00::/7), link-local (fe80::/10), and multicast (ff00::/8).
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) return true;
  // Documentation and other non-routable special-use IPv6 ranges.
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return true;

  // Reject IPv4-compatible, IPv4-mapped, and IPv4-translated forms even when
  // the embedded IPv4 address is written as hexadecimal IPv6 groups.
  const isIpv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isIpv4Translated = groups.slice(0, 4).every((group) => group === 0) && groups[4] === 0xffff && groups[5] === 0;
  if (isIpv4Compatible || isIpv4Mapped || isIpv4Translated) {
    const embeddedV4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateV4(embeddedV4);
  }
  return false;
}

function parseIpv6Groups(value: string): number[] | null {
  if (!value || value.includes(":::")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseParts = (part: string): number[] | null => {
    if (!part) return [];
    const parts = part.split(":");
    const groups: number[] = [];
    for (let index = 0; index < parts.length; index++) {
      const segment = parts[index];
      if (segment.includes(".")) {
        if (index !== parts.length - 1) return null;
        const octets = segment.split(".").map(Number);
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(segment)) return null;
        groups.push(parseInt(segment, 16));
      }
    }
    return groups;
  };

  const left = parseParts(halves[0]);
  const right = parseParts(halves.length === 2 ? halves[1] : "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return left.concat(new Array(missing).fill(0), right);
}

export function isPublicAddress(address: string, family?: number): boolean {
  const detectedFamily = family || net.isIP(address);
  if (detectedFamily === 4) return !isPrivateV4(address);
  if (detectedFamily === 6) return !isPrivateV6(address);
  return false;
}

function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${url.protocol}`);
  }
  if (!url.hostname || /^localhost$/i.test(url.hostname) || url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    throw new Error("Blocked URL host");
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  return url;
}

export interface PinnedAddress {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export function createPinnedLookup(address: PinnedAddress) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (error: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
  ) => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

export async function resolvePinnedPublicAddress(rawUrl: string): Promise<{ url: URL; address: PinnedAddress }> {
  const url = validateUrl(rawUrl);
  const literalFamily = net.isIP(url.hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicAddress(url.hostname, literalFamily)) {
      throw new Error(`Blocked private or reserved address: ${url.hostname}`);
    }
    return {
      url,
      address: { hostname: url.hostname, address: url.hostname, family: literalFamily },
    };
  }

  const records = await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!records.length) throw new Error(`DNS lookup failed for ${url.hostname}`);
  const publicRecord = records.find((record) => isPublicAddress(record.address, record.family));
  if (!publicRecord) throw new Error(`DNS resolved only to private or reserved addresses: ${url.hostname}`);

  // Reject mixed public/private answers instead of selecting a public answer
  // while leaving a later connection vulnerable to DNS round-robin changes.
  if (records.some((record) => !isPublicAddress(record.address, record.family))) {
    throw new Error(`DNS response contains a private or reserved address: ${url.hostname}`);
  }

  return {
    url,
    address: {
      hostname: url.hostname,
      address: publicRecord.address,
      family: publicRecord.family as 4 | 6,
    },
  };
}

function headerValue(headers: http.IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value ?? "";
}

function decodeResponseBody(buffer: Buffer, contentEncoding: string, maxOutputLength: number): Buffer {
  const encoding = contentEncoding.toLowerCase().trim();
  if (!encoding || encoding === "identity") return buffer;
  if (encoding.includes("br")) return zlib.brotliDecompressSync(buffer, { maxOutputLength });
  if (encoding.includes("gzip") || encoding.includes("deflate")) return zlib.unzipSync(buffer, { maxOutputLength });
  throw new Error(`Unsupported response encoding: ${contentEncoding}`);
}

async function requestPinned(
  url: URL,
  address: PinnedAddress,
  options: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml,application/json,*/*;q=0.5",
          ...options.headers,
        },
         lookup: createPinnedLookup(address),
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > options.maxBytes) {
            response.destroy();
            fail(new Error(`Response exceeded ${options.maxBytes} byte limit`));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", (error) => fail(error));
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
    });
    request.on("error", fail);
    request.end();
  });
}

export async function fetchPublicText(
  rawUrl: string,
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<PublicTextResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const { url, address } = await resolvePinnedPublicAddress(currentUrl);
    const response = await requestPinned(url, address, { timeoutMs, maxBytes, headers: options.headers });
    const location = headerValue(response.headers, "location");

    if (response.status >= 300 && response.status < 400 && location) {
      if (redirect === maxRedirects) throw new Error("Too many redirects");
      currentUrl = new URL(location, url).toString();
      continue;
    }

    const decoded = decodeResponseBody(response.body, headerValue(response.headers, "content-encoding"), maxBytes);
    if (decoded.length > maxBytes) throw new Error(`Decoded response exceeded ${maxBytes} byte limit`);
    return {
      url: url.toString(),
      status: response.status,
      headers: response.headers,
      text: decoded.toString("utf8"),
    };
  }

  throw new Error("Too many redirects");
}