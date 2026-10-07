import assert from "node:assert/strict";
import path from "node:path";
import puppeteer from "puppeteer";

// Optional read-only check against a public market's real saved arrangement.
// Render current development code with GET data from the supplied public site;
// block ALL writes. Never log in, edit labels, or mutate the source database.
const source = process.env.QUADRANT_PUBLIC_SOURCE_URL;
if (!source) throw new Error("Set QUADRANT_PUBLIC_SOURCE_URL to the verified public deployment URL");
const slug = process.env.QUADRANT_MARKET_SLUG || "b2b_marketing_automation_platforms";
const dev = process.env.MAGIC_QUADRANT_TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const read = async (route: string) => {
  const response = await fetch(new URL(route, source));
  if (!response.ok) throw new Error(`Public market GET ${route}: ${response.status}`);
  return response.json();
};
const market = await read(`/api/markets/${slug}`);
const routes = [
  `/api/markets/${market.id}/vendors`,
  `/api/markets/${market.id}/scores`,
  `/api/markets/${market.id}/chart-config`,
  `/api/markets/${market.id}/label-positions`,
  `/api/criteria`,
];
const responses = new Map(await Promise.all(routes.map(async route => [route, await read(route)] as const)));
responses.set(`/api/markets/${slug}`, market);
const browser = await puppeteer.launch({
  headless: true, pipe: true,
  enableExtensions: [path.resolve("scripts/fixtures/chart-zoom-extension")],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return request.continue();
    if (request.method() !== "GET") return request.respond({ status: 204, body: "" });
    const body = url.pathname === "/api/auth/user"
      ? { id: "zoom-readonly-fixture", role: "admin", persona: "buyer", featureAccess: [] }
      : (responses.get(url.pathname) ?? []);
    return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${dev}/markets/${slug}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".vendor-dot");
  const worker = await (await browser.waitForTarget(t => t.type() === "service_worker")).worker();
  assert.ok(worker);
  let baseline: string | undefined;
  for (const zoom of [.67, .8, .9, 1, 1.1, 1.25, 1.5, 1.25, 1.1, 1, .9, .8, .67]) {
    await worker.evaluate(async ({ zoom, dev }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(dev))!;
      await chrome.tabs.setZoom(tab.id!, zoom);
    }, { zoom, dev });
    await new Promise(resolve => setTimeout(resolve, 350));
    const graphic = await page.$eval(".vendor-dot", dot => {
      const svg = dot.ownerSVGElement!;
      return { svg: svg.innerHTML, viewBox: svg.getAttribute("viewBox"), dots: svg.querySelectorAll(".vendor-dot").length };
    });
    assert.equal(graphic.viewBox, "0 0 760 547");
    if (!baseline) baseline = graphic.svg;
    assert.equal(graphic.svg, baseline, `entire live arrangement stays identical at ${zoom}`);
    console.log(`${market.name}: ${graphic.dots} vendors, ${Math.round(zoom * 100)}% browser zoom: unchanged SVG geometry`);
    if (zoom === .67 || zoom === 1.5) {
      const chart = await page.$('[data-testid="market-shared-chart"]');
      await chart!.screenshot({ path: `/tmp/quadrant-market-${Math.round(zoom * 100)}.png` });
    }
  }
} finally {
  await browser.close();
}
