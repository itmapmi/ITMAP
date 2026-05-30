import OpenAI from "openai";
import crypto from "crypto";
import { createAgentRun } from "../storage/datasheets";
import { assertPublicUrl } from "./ssrfGuard";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  return _openai;
}

// Per-domain polite throttle: at most one fetch every 2s per host.
const lastFetchByHost = new Map<string, number>();
const PER_HOST_DELAY_MS = 2000;
async function politeWait(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastFetchByHost.get(host) ?? 0;
  const wait = Math.max(0, PER_HOST_DELAY_MS - (Date.now() - last));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchByHost.set(host, Date.now());
}

// Lightweight robots.txt check (no full RFC compliance — just disallow path scan).
async function isAllowedByRobots(url: string, userAgent = "spectio-rediscovery"): Promise<boolean> {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    // SSRF: validate robots URL host before fetching.
    await assertPublicUrl(robotsUrl);
    const resp = await safeFetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return true;
    const text = await resp.text();
    const lines = text.split(/\r?\n/);
    let active = false;
    let allowed = true;
    for (const ln of lines) {
      const t = ln.trim();
      if (!t || t.startsWith("#")) continue;
      const [key, ...rest] = t.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) {
        active = value === "*" || value.toLowerCase().includes(userAgent.toLowerCase());
        continue;
      }
      if (!active) continue;
      if (/^disallow$/i.test(key) && value && u.pathname.startsWith(value)) allowed = false;
      if (/^allow$/i.test(key) && value && u.pathname.startsWith(value)) allowed = true;
    }
    return allowed;
  } catch {
    return true;
  }
}

// Render page HTML using puppeteer. Reuses launchBrowser() from the PDF service,
// which tries each Chromium candidate (project-local downloaded Chrome first,
// then env overrides and Nix discovery) and actually probes launch so admin
// rediscovery succeeds in every environment where PDF generation works.
async function renderPageHtml(url: string): Promise<string> {
  await assertPublicUrl(url);
  const { launchBrowser } = await import("../pdf-generator/pdf-service");
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 spectio-rediscovery/1.0");
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

export interface DatasheetCandidate {
  productName: string;
  candidateDatasheetUrl: string;
  confidence: number;
  reasoning?: string;
}

export interface RediscoverResult {
  candidates: DatasheetCandidate[];
  pageTitle: string;
  sourceUrl: string;
}

export async function rediscoverDatasheetCandidates(opts: {
  vendorId: string;
  productIndexUrl: string;
  triggeredByUserId?: string;
}): Promise<RediscoverResult> {
  const start = Date.now();
  if (!await isAllowedByRobots(opts.productIndexUrl)) {
    await createAgentRun({
      runType: "rediscover_candidates",
      vendorId: opts.vendorId,
      triggeredByUserId: opts.triggeredByUserId ?? null,
      status: "skipped",
      inputUrl: opts.productIndexUrl,
      errorMessage: "Blocked by robots.txt",
      durationMs: Date.now() - start,
    });
    throw new Error("URL is blocked by robots.txt");
  }
  await politeWait(opts.productIndexUrl);
  try {
    const html = await renderPageHtml(opts.productIndexUrl);
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : "";

    // Extract candidate links (href + anchor text) and condense for LLM.
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const links: Array<{ href: string; text: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
      let abs: string;
      try { abs = new URL(href, opts.productIndexUrl).toString(); } catch { continue; }
      links.push({ href: abs, text: text.slice(0, 120) });
      if (links.length >= 400) break;
    }
    const linkSample = links.map((l, i) => `[${i}] ${l.text} -> ${l.href}`).join("\n");

    const ai = getOpenAI();
    const prompt = `You are scanning a vendor's product-index page to find product datasheets (PDFs or "specs" pages). Page URL: ${opts.productIndexUrl}\nPage title: ${pageTitle}\n\nLinks (anchor text -> href):\n${linkSample}\n\nReturn JSON: {"candidates":[{"productName":"...","candidateDatasheetUrl":"...","confidence":0.0,"reasoning":"..."}]} with up to 20 high-confidence datasheet links. Prefer PDFs and pages with "datasheet", "spec", or "brochure" in URL or anchor text. Confidence 0.0-1.0.`;
    const resp = await ai.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You extract structured datasheet candidate URLs from rendered vendor pages. Always return strict JSON." },
        { role: "user", content: prompt },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? "{}";
    let parsed: { candidates?: DatasheetCandidate[] } = {};
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const candidates = (parsed.candidates ?? [])
      .filter(c => c.candidateDatasheetUrl && c.productName)
      .map(c => ({ ...c, confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)) }));

    await createAgentRun({
      runType: "rediscover_candidates",
      vendorId: opts.vendorId,
      triggeredByUserId: opts.triggeredByUserId ?? null,
      status: "success",
      inputUrl: opts.productIndexUrl,
      outputJson: { candidateCount: candidates.length, pageTitle },
      durationMs: Date.now() - start,
    });
    return { candidates, pageTitle, sourceUrl: opts.productIndexUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await createAgentRun({
      runType: "rediscover_candidates",
      vendorId: opts.vendorId,
      triggeredByUserId: opts.triggeredByUserId ?? null,
      status: "failed",
      inputUrl: opts.productIndexUrl,
      errorMessage: msg,
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

// Manual-redirect fetch that re-validates every hop against the SSRF guard.
// Prevents private-IP bypass via redirect chains (e.g. http://evil.example →
// http://10.0.0.5).
export async function safeFetch(url: string, init: RequestInit = {}, maxHops = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(current);
    const resp = await fetch(current, { ...init, redirect: "manual" });
    const status = resp.status;
    if (status >= 300 && status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      current = new URL(loc, current).toString();
      continue;
    }
    return resp;
  }
  throw new Error(`Too many redirects (>${maxHops})`);
}

// Download a remote URL into a buffer with size cap (default 20 MB).
export async function downloadUrlToBuffer(url: string, maxBytes = 20 * 1024 * 1024): Promise<{ buffer: Buffer; contentType: string; hash: string }> {
  await assertPublicUrl(url);
  if (!await isAllowedByRobots(url)) throw new Error("URL is blocked by robots.txt");
  await politeWait(url);
  const resp = await safeFetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status} for ${url}`);
  const lenHeader = resp.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > maxBytes) throw new Error(`File too large (${lenHeader} bytes)`);
  const arr = new Uint8Array(await resp.arrayBuffer());
  if (arr.byteLength > maxBytes) throw new Error(`File too large (${arr.byteLength} bytes)`);
  const buffer = Buffer.from(arr);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, contentType: resp.headers.get("content-type") ?? "application/octet-stream", hash };
}
