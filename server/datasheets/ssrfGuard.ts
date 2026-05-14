import { promises as dns } from "dns";
import net from "net";

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(n => parseInt(n, 10));
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  if (p[0] === 10) return true;
  if (p[0] === 127) return true;
  if (p[0] === 0) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] >= 224) return true;
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lc = ip.toLowerCase();
  if (lc === "::1" || lc === "::") return true;
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true;
  if (lc.startsWith("fe80")) return true;
  if (lc.startsWith("::ffff:")) {
    const v4 = lc.slice("::ffff:".length);
    return isPrivateV4(v4);
  }
  return false;
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked scheme: ${u.protocol}`);
  }
  const host = u.hostname;
  if (!host) throw new Error("URL has no host");
  if (/^localhost$/i.test(host) || host === "0.0.0.0") throw new Error("Blocked host");
  // If host is already an IP literal, validate directly.
  if (net.isIP(host) === 4 && isPrivateV4(host)) throw new Error("Blocked private IPv4");
  if (net.isIP(host) === 6 && isPrivateV6(host)) throw new Error("Blocked private IPv6");
  if (net.isIP(host) === 0) {
    // DNS-resolve and ensure all answers are public.
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    if (records.length === 0) throw new Error("DNS lookup failed");
    for (const r of records) {
      if (r.family === 4 && isPrivateV4(r.address)) throw new Error(`Blocked private IPv4 (${r.address})`);
      if (r.family === 6 && isPrivateV6(r.address)) throw new Error(`Blocked private IPv6 (${r.address})`);
    }
  }
  return u;
}
