/**
 * server/geoResolver.ts
 *
 * Coarse GeoIP resolution using ipwho.is (no API key required).
 * – Never trusts client-provided geo.
 * – Normalises IPv4-mapped IPv6 addresses (::ffff:x.x.x.x → x.x.x.x).
 * – Classifies private/loopback IPs as Unknown without a network call.
 * – Caps response body at 4 KB to avoid memory blow-up on malformed replies.
 * – Caches results for 1 hour; bounded at 2000 entries (LRU-ish eviction).
 * – 2 s request timeout; fails explicitly to Unknown — never fabricates data.
 */

import https from "https";
import net from "node:net";

export interface GeoResult {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

const UNKNOWN: GeoResult = {
  countryCode: null,
  country: "Unknown",
  region: null,
  city: null,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 2000;
const REQUEST_TIMEOUT_MS = 2000;
const MAX_RESPONSE_BYTES = 4096;

const cache = new Map<string, { result: GeoResult; expiresAt: number }>();

/**
 * Normalise an IP string:
 *  - Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 → 1.2.3.4).
 *  - Lowercase and trim.
 */
function normaliseIp(raw: string): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("::ffff:")) return s.slice(7);
  return s;
}

/** Returns true for private / loopback / link-local addresses. */
function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "unknown") return true;
  const version = net.isIP(ip);
  if (version === 6) {
    return ip === "::1"
      || ip === "::"
      || ip.startsWith("fc")
      || ip.startsWith("fd")
      || ip.startsWith("fe8")
      || ip.startsWith("fe9")
      || ip.startsWith("fea")
      || ip.startsWith("feb");
  }
  if (version !== 4) return true;
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return true;                        // loopback
  if (a === 10) return true;                         // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true;           // RFC 1918
  if (a === 169 && b === 254) return true;           // link-local
  if (a === 0) return true;                          // 0.0.0.0/8
  return false;
}

function fetchGeo(ip: string): Promise<GeoResult> {
  return new Promise((resolve) => {
    // ipwho.is returns JSON with: success, country_code, country, region, city
    const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
    let settled = false;

    const settle = (r: GeoResult) => {
      if (!settled) { settled = true; resolve(r); }
    };

    const req = https.get(url, (res) => {
      let data = "";
      let bytes = 0;
      res.on("data", (chunk: Buffer | string) => {
        bytes += typeof chunk === "string" ? chunk.length : chunk.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy();
          settle(UNKNOWN);
          return;
        }
        data += chunk.toString();
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          // ipwho.is sets success=true on valid lookups
          if (!json.success) { settle(UNKNOWN); return; }
          const countryCode = typeof json.country_code === "string" && json.country_code ? json.country_code : null;
          const country     = typeof json.country === "string" && json.country ? json.country : null;
          const region      = typeof json.region === "string" && json.region ? json.region : null;
          const city        = typeof json.city === "string" && json.city ? json.city : null;
          settle({ countryCode, country, region, city });
        } catch {
          settle(UNKNOWN);
        }
      });
      res.on("error", () => settle(UNKNOWN));
    });

    req.on("error", () => settle(UNKNOWN));
    req.on("timeout", () => { req.destroy(); settle(UNKNOWN); });
    req.setTimeout(REQUEST_TIMEOUT_MS);
  });
}

/** Resolves coarse geo for an IP. Never throws. Returns UNKNOWN on any error. */
export async function resolveGeo(rawIp: string): Promise<GeoResult> {
  const ip = normaliseIp(rawIp);

  if (!ip || isPrivateIp(ip)) {
    return UNKNOWN;
  }

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const result = await fetchGeo(ip);
    if (cache.size >= CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(ip, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return UNKNOWN;
  }
}
