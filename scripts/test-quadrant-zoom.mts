import assert from "node:assert/strict";
import type { Browser, Page } from "puppeteer";

/** Runs inside the existing intercepted fixture: no real database writes. */
export async function verifyDesktopZoom(browser: Browser, page: Page, vendorId: string, baseUrl: string, marketSlug: string) {
  const target = await browser.waitForTarget(t => t.type() === "service_worker");
  const worker = await target.worker();
  assert.ok(worker, "browser zoom extension must be running");
  const setZoom = async (factor: number) => {
    const actual = await worker.evaluate(async ({ factor, baseUrl }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url?.startsWith(baseUrl));
      if (!tab?.id) throw new Error("Fixture tab not found");
      await chrome.tabs.setZoom(tab.id, factor);
      return chrome.tabs.getZoom(tab.id);
    }, { factor, baseUrl });
    assert.equal(actual, factor, "must use real browser tab zoom");
    await new Promise(resolve => setTimeout(resolve, 350));
  };
  const geometry = () => page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>(".vendor-dot")!.ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const matrix = svg.getScreenCTM()!;
    const menu = document.querySelector('[data-testid="market-section-menu"]')!;
    const section = document.querySelector('[data-testid="market-shared-chart"]')!;
    return {
      viewBox: svg.getAttribute("viewBox"),
      width: Number(svg.getAttribute("width")),
      height: Number(svg.getAttribute("height")),
      scaleX: matrix.a,
      scaleY: matrix.d,
      displayWidth: rect.width,
      spaceToMenu: menu.getBoundingClientRect().top - section.getBoundingClientRect().bottom,
      menuBackground: getComputedStyle(menu).backgroundColor,
      dpr: devicePixelRatio,
      vendors: Array.from(svg.querySelectorAll(".vendor-group")).map(group => {
        const dot = group.querySelector(".vendor-dot")!;
        const label = group.querySelector(".vendor-label")!;
        const x = Number(dot.getAttribute("cx")), y = Number(dot.getAttribute("cy"));
        const lx = Number(label.getAttribute("x")), ly = Number(label.getAttribute("y"));
        const dotScreen = new DOMPoint(x, y).matrixTransform(matrix);
        const labelScreen = new DOMPoint(lx, ly).matrixTransform(matrix);
        return {
          id: group.getAttribute("data-vendor-id"), x, y, lx, ly,
          font: label.getAttribute("font-size"),
          normalizedDx: (labelScreen.x - dotScreen.x) / matrix.a,
          normalizedDy: (labelScreen.y - dotScreen.y) / matrix.d,
        };
      }),
    };
  });
  await setZoom(.67);
  const baseline = await geometry();
  assert.equal(baseline.viewBox, "0 0 760 547");
  assert.equal(baseline.width, 760);
  assert.equal(baseline.height, 547);
  assert.equal(baseline.vendors[0].lx, 490, "existing manual placement is honored");
  assert.equal(baseline.vendors[0].ly, 218);
  const levels = [.67, .8, .9, 1, 1.1, 1.25, 1.5, 1.25, 1.1, 1, .9, .8, .67];
  for (const zoom of levels) {
    await setZoom(zoom);
    const current = await geometry();
    assert.equal(current.viewBox, baseline.viewBox);
    assert.ok(Math.abs(current.scaleX - current.scaleY) < 1e-6, "uniform graphic scale");
    assert.equal(current.menuBackground, baseline.menuBackground, "desktop menu stays light blue");
    assert.ok(current.spaceToMenu >= 37.79, "at least 1cm graph/menu separation");
    for (let index = 0; index < current.vendors.length; index++) {
      const actual = current.vendors[index], expected = baseline.vendors[index];
      for (const key of ["x", "y", "lx", "ly", "normalizedDx", "normalizedDy"] as const) {
        assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${key} invariant at ${zoom}`);
      }
      assert.equal(actual.font, expected.font);
    }
    console.log(`Browser zoom ${Math.round(zoom * 100)}%: invariant geometry, scale ${current.scaleX.toFixed(3)}, DPR ${current.dpr}`);
  }

  // Narrow desktop below the viewport hook's breakpoint; never switch canvases.
  await page.setViewport({ width: 900, height: 800 });
  await setZoom(1.5);
  const narrow = await geometry();
  assert.equal(narrow.viewBox, baseline.viewBox);
  assert.equal(narrow.vendors[0].lx, baseline.vendors[0].lx);
  assert.equal(narrow.vendors[0].x, baseline.vendors[0].x);
  assert.ok(narrow.displayWidth < baseline.displayWidth);

  // Track writes: zoom/resize is read-only. Persist only an explicit Save.
  const writes: any[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/label-positions" && request.method() === "POST") {
      writes.push(JSON.parse(request.postData()!));
    }
  });
  // Drag at two real tab zoom levels, including a small fitted chart.
  for (const zoom of [1.5, .8]) {
    await setZoom(zoom);
    await page.click('[data-testid="button-edit-labels"]');
    const selector = `[data-vendor-id="${vendorId}"] .vendor-label`;
    await page.waitForSelector(selector);
    const before = await page.$eval(selector, label => {
      const matrix = label.ownerSVGElement!.getScreenCTM()!;
      const x = Number(label.getAttribute("x")), y = Number(label.getAttribute("y"));
      const grab = new DOMPoint(x + 4, y - 3).matrixTransform(matrix);
      return { x, y, grabX: grab.x, grabY: grab.y, scale: matrix.a };
    });
    await page.mouse.move(before.grabX, before.grabY);
    await page.mouse.down();
    await page.mouse.move(before.grabX + 18 * before.scale, before.grabY + 12 * before.scale, { steps: 8 });
    await page.mouse.up();
    const after = await page.$eval(selector, label => ({
      x: Number(label.getAttribute("x")), y: Number(label.getAttribute("y")),
    }));
    assert.ok(Math.abs(after.x - before.x - 18) < 2, "scaled drag X preserves grab offset");
    assert.ok(Math.abs(after.y - before.y - 12) < 2, "scaled drag Y preserves grab offset");
    assert.equal(writes.length, zoom === 1.5 ? 0 : 1, "only explicit save writes positions");
    await page.click('[data-testid="button-save-label-positions"]');
    await page.waitForSelector('[data-testid="button-edit-labels"]');
    const saved = writes.at(-1);
    assert.ok(Math.abs(saved.labelX - after.x) < .01);
    assert.ok(Math.abs(saved.labelY - after.y) < .01);
    await page.reload({ waitUntil: "networkidle0" });
    const reloaded = await page.$eval(selector, label => ({
      x: Number(label.getAttribute("x")), y: Number(label.getAttribute("y")),
    }));
    assert.ok(Math.abs(reloaded.x - after.x) < .01, "saved placement survives reload");
    assert.ok(Math.abs(reloaded.y - after.y) < .01);
  }

  // Capture the actual export's serialized SVG and downloaded PDF in-browser.
  await page.evaluate(() => {
    const state = window as any;
    state.chartExports = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = function(blob: Blob) {
      if (/svg|pdf/.test(blob.type)) state.chartExports.push(blob);
      return original.call(URL, blob);
    };
  });
  for (const zoom of [.67, 1.5]) {
    await setZoom(zoom);
    await page.click('button[title="Export chart as PDF"]');
    await page.waitForFunction(() => (window as any).chartExports.filter((b: Blob) => b.type === "application/pdf").length >= 1);
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("Exporting")));
  }
  const exports = await page.evaluate(async () => {
    const blobs: Blob[] = (window as any).chartExports;
    return {
      svgs: await Promise.all(blobs.filter(b => b.type.startsWith("image/svg")).map(b => b.text())),
      pdfs: await Promise.all(blobs.filter(b => b.type === "application/pdf").map(async b => Array.from(new Uint8Array(await b.arrayBuffer())))),
    };
  });
  assert.equal(exports.pdfs.length, 2, "both zoom levels export a PDF");
  assert.equal(exports.svgs[0], exports.svgs[1], "exported graphic is identical at both display scales");
  assert.ok(exports.svgs[0].includes('viewBox="0 0 760 547"'));
  assert.ok(!exports.svgs[0].includes("width: 100%"));
  // pdfjs verifies the title in the actual document, not just the source code.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const bytes of exports.pdfs) {
    const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    assert.ok(content.items.some((item: any) => item.str === "Historical Browser Fixture"), "PDF retains market title");
    await pdf.destroy();
  }

  // Dot hit testing and HTML evidence anchor use the same displayed scale.
  const dotSelector = `[data-vendor-id="${vendorId}"] .vendor-dot`;
  await page.click(dotSelector);
  await page.waitForSelector('[data-state="open"][role="dialog"]');
  const anchorError = await page.$eval(dotSelector, dot => {
    const rect = dot.getBoundingClientRect();
    const svg = dot.ownerSVGElement!;
    const container = svg.closest(".relative.w-full")!;
    const anchor = container.querySelector("button.absolute.w-1")!.getBoundingClientRect();
    return Math.hypot(anchor.x + anchor.width / 2 - rect.x - rect.width / 2, anchor.y + anchor.height / 2 - rect.y - rect.height / 2);
  });
  assert.ok(anchorError < 1, "evidence anchor follows fitted dot");
  await page.keyboard.press("Escape");
  assert.equal(writes.length, 2, "no writes from fitting, export, or dot interaction");

  // Dedicated mobile keeps its existing 760×547 pan/zoom canvas and empty selection.
  await setZoom(1);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${baseUrl}/mobile/markets/${marketSlug}`, { waitUntil: "networkidle0" });
  const mobile = await geometryForMobile(page);
  assert.equal(mobile.viewBox, "0 0 760 547");
  assert.equal(mobile.width, 760);
  assert.equal(mobile.height, 547);
  assert.equal(mobile.highlighted, 0);
  assert.ok(mobile.transform.includes("scale("), "mobile still has independent transformed canvas");
  assert.equal(await page.$('[data-testid="timeline-slider"]'), null);
  console.log("Desktop browser zoom, drag/save/reload, PDF, evidence, and mobile boundary regressions passed.");
}

async function geometryForMobile(page: Page) {
  await page.waitForSelector(".vendor-dot");
  return page.$eval(".vendor-dot", dot => {
    const svg = dot.ownerSVGElement!;
    return {
      viewBox: svg.getAttribute("viewBox"),
      width: Number(svg.getAttribute("width")),
      height: Number(svg.getAttribute("height")),
      highlighted: svg.querySelectorAll('.vendor-dot[r="7"]').length,
      transform: svg.parentElement!.style.transform,
    };
  });
}
