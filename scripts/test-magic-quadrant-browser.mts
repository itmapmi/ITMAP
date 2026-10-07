import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer, { type Page } from "puppeteer";
import path from "node:path";
import { verifyDesktopZoom } from "./test-quadrant-zoom.mts";
import { DEFAULT_QUADRANT_THRESHOLDS, positionFromComposites } from "../shared/quadrant-positioning";

// Browser regression for the historical slider: stored snapshots are raw
// weighted composites in rubric units (0–10) and the chart re-plots them
// through the market's thresholds with the shared piecewise transform — the
// same engine used here to compute the expected pixel coordinates.
const baseUrl = process.env.MAGIC_QUADRANT_TEST_BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const marketSlug = "historical-browser-fixture";
const marketId = "historical-browser-fixture";
const vendorId = "vendor-alpha";
const dayMs = 24 * 60 * 60 * 1000;
const historicalTestWeeks = [6, 20];

const market = {
  id: marketId,
  name: "Historical Browser Fixture",
  description: "Fixture market for the historical slider browser regression test.",
  visibility: "public",
  isVisible: true,
  marketType: "mature",
  executionThresholdLow: DEFAULT_QUADRANT_THRESHOLDS.executionLow.toFixed(2),
  executionThresholdHigh: DEFAULT_QUADRANT_THRESHOLDS.executionHigh.toFixed(2),
  viabilityThreshold: DEFAULT_QUADRANT_THRESHOLDS.viability.toFixed(2),
};

// Published chart configuration as served by GET /api/markets/:id/chart-config.
const chartConfig = {
  marketId,
  marketType: "mature",
  thresholds: { ...DEFAULT_QUADRANT_THRESHOLDS },
  weights: [],
  weightsById: {},
  weightVersion: null,
};

// Composite scores (0–10) for the two snapshots the slider should reach.
const selectedScores = {
  old: { execution: 2, viability: 3 },
  new: { execution: 7, viability: 6 },
};

const vendors = [
  { id: vendorId, marketId, name: "Vendor Alpha" },
  { id: "vendor-beta", marketId, name: "Vendor Beta" },
];

const allHistory = [
  {
    id: "history-alpha-old",
    vendorId,
    marketId,
    executionScore: "1.5",
    viabilityScore: "2.5",
    recordedAt: new Date(Date.now() - 730 * dayMs).toISOString(),
  },
  {
    id: "history-alpha-new",
    vendorId,
    marketId,
    executionScore: "7.5",
    viabilityScore: "6.5",
    recordedAt: new Date(Date.now() - 365 * dayMs).toISOString(),
  },
  {
    id: "history-beta-old",
    vendorId: "vendor-beta",
    marketId,
    executionScore: "8.5",
    viabilityScore: "7.5",
    recordedAt: new Date(Date.now() - 730 * dayMs).toISOString(),
  },
  {
    id: "history-beta-new",
    vendorId: "vendor-beta",
    marketId,
    executionScore: "2.5",
    viabilityScore: "3.5",
    recordedAt: new Date(Date.now() - 365 * dayMs).toISOString(),
  },
];

type HistoricalRow = { id: string; vendorId: string; marketId: string; executionScore: string; viabilityScore: string; recordedAt?: string };
const selectedWeekRequests: Array<{ date: string; positions: HistoricalRow[] }> = [];
const allHistoryRequests: Array<{ positions: HistoricalRow[] }> = [];
const labelPositions = [{ vendorId, labelX: "490", labelY: "218", updatedAt: "2026-10-01T00:00:00Z" }];

function selectedPositions(dateValue: string) {
  // The six-month slider's early and late positions should resolve to distinct
  // historical snapshots. Use the browser's requested date so the test stays
  // stable as calendar months vary in length.
  const date = new Date(dateValue).getTime();
  const threshold = Date.now() - 90 * dayMs;
  const older = date < threshold;
  return older
    ? [
        { id: "selected-alpha-old", vendorId, marketId, executionScore: String(selectedScores.old.execution), viabilityScore: String(selectedScores.old.viability) },
        { id: "selected-beta-old", vendorId: "vendor-beta", marketId, executionScore: "8", viabilityScore: "7" },
      ]
    : [
        { id: "selected-alpha-new", vendorId, marketId, executionScore: String(selectedScores.new.execution), viabilityScore: String(selectedScores.new.viability) },
        { id: "selected-beta-new", vendorId: "vendor-beta", marketId, executionScore: "3", viabilityScore: "4" },
      ];
}

/**
 * Where the chart must draw a stored composite pair: through the shared
 * piecewise transform (thresholds → 33 / 67 / 50 dividers) into the 0–100
 * canvas, then through the desktop chart's linear pixel scales (60 px left
 * / 20 px right margins, 44 px top / 82 px bottom).
 */
function expectedPixel(scores: { execution: number; viability: number }, width: number, height: number) {
  const { x, y } = positionFromComposites(scores, chartConfig.thresholds);
  return {
    x: 60 + (x / 100) * (width - 80),
    y: height - 82 - (y / 100) * (height - 126),
  };
}

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function ensureServer() {
  try {
    const response = await fetch(`${baseUrl}/`);
    if (response.ok) return null;
  } catch {
    // Start a local dev server below when the configured preview is not running.
  }

  const child = spawn("npm", ["run", "dev"], {
    env: { ...process.env, PORT: new URL(baseUrl).port || "5000" },
    stdio: "inherit",
  });
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/`)).ok;
    } catch {
      return false;
    }
  }, "the development server", 30_000);
  return child;
}

async function setSliderValue(page: Page, value: number) {
  const slider = await page.$('[data-testid="timeline-slider"] [role="slider"]');
  assert.ok(slider, "timeline slider thumb should be rendered");
  await slider.focus();

  // Radix exposes the current value through aria-valuenow. Clicking the track
  // would be approximate because the thumb has its own width, so use Home plus
  // discrete ArrowRight events for an exact week index.
  await page.keyboard.press("Home");
  for (let index = 0; index < value; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForFunction(
    expected => document.querySelector('[data-testid="timeline-slider"] [role="slider"]')?.getAttribute("aria-valuenow") === String(expected),
    {},
    value,
  );
}

async function readVendorCoordinates(page: Page) {
  return page.$eval(
    `[data-vendor-id="${vendorId}"] .vendor-dot`,
    dot => {
      const svg = dot.ownerSVGElement;
      return {
        x: Number(dot.getAttribute("cx")),
        y: Number(dot.getAttribute("cy")),
        width: Number(svg?.getAttribute("width")),
        height: Number(svg?.getAttribute("height")),
      };
    },
  );
}

async function waitForVendorCoordinates(page: Page, scores: { execution: number; viability: number }) {
  // The canvas position (0–100) is computed here with the shared engine; the
  // browser only has to apply the chart's pixel scales for its current size.
  const canvas = positionFromComposites(scores, chartConfig.thresholds);
  await page.waitForFunction(
    ({ vendorId: expectedVendorId, x, y }) => {
      const dot = document.querySelector(`[data-vendor-id="${expectedVendorId}"] .vendor-dot`);
      const svg = dot?.ownerSVGElement;
      if (!dot || !svg) return false;

      const width = Number(svg.getAttribute("width"));
      const height = Number(svg.getAttribute("height"));
      const expectedX = 60 + (x / 100) * (width - 80);
      const expectedY = height - 82 - (y / 100) * (height - 126);
      return Math.abs(Number(dot.getAttribute("cx")) - expectedX) < 0.1
        && Math.abs(Number(dot.getAttribute("cy")) - expectedY) < 0.1;
    },
    {},
    { vendorId, x: canvas.x, y: canvas.y },
  );
  return readVendorCoordinates(page);
}

async function run() {
  const serverProcess = await ensureServer();
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [path.resolve("scripts/fixtures/chart-zoom-extension")],
  });
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) {
        await request.continue();
        return;
      }

      if (request.method() !== "GET") {
        if (url.pathname === "/api/label-positions") {
          const data = JSON.parse(request.postData()!);
          const row = labelPositions.find(row => row.vendorId === data.vendorId)!;
          row.labelX = String(data.labelX);
          row.labelY = String(data.labelY);
        }
        await request.respond({ status: 204, body: "" });
        return;
      }

      if (url.pathname === "/api/auth/user") {
        await request.respond(jsonResponse({
          id: "browser-test-user",
          email: "browser-test@example.com",
          role: "admin",
          persona: "buyer",
          featureAccess: [],
        }));
        return;
      }

      if (url.pathname === `/api/markets/${marketSlug}`) {
        await request.respond(jsonResponse(market));
        return;
      }

      if (url.pathname === `/api/markets/${marketId}/vendors`) {
        await request.respond(jsonResponse(vendors));
        return;
      }

      if (url.pathname === `/api/markets/${marketId}/chart-config`) {
        await request.respond(jsonResponse(chartConfig));
        return;
      }
      if (url.pathname === `/api/markets/${marketId}/label-positions`) {
        await request.respond(jsonResponse(labelPositions));
        return;
      }

      if (url.pathname === `/api/markets/${marketId}/historical-positions`) {
        const date = url.searchParams.get("date");
        if (date) {
          selectedWeekRequests.push({ date, positions: selectedPositions(date) });
          await request.respond(jsonResponse(selectedPositions(date)));
        } else {
          allHistoryRequests.push({ positions: allHistory });
          await request.respond(jsonResponse(allHistory));
        }
        return;
      }

      // The chart only needs empty supporting datasets for this fixture.
      await request.respond(jsonResponse([]));
    });

    await page.goto(`${baseUrl}/markets/${marketSlug}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="timeline-slider"] [role="slider"]');
    await page.waitForSelector(`[data-vendor-id="${vendorId}"] .vendor-dot`);
    await waitFor(() => allHistoryRequests.length === 1, "the all-history trajectory response");
    assert.equal(allHistoryRequests[0].positions.length, allHistory.length);

    const coordinatesByWeek = new Map<number, { x: number; y: number; width: number; height: number }>();
    const requestsByWeek = new Map<number, { date: string; positions: HistoricalRow[] } | undefined>();
    for (const week of historicalTestWeeks) {
      await setSliderValue(page, week);
      const expectedPositionId = week === historicalTestWeeks[0] ? "selected-alpha-old" : "selected-alpha-new";
      await waitFor(
        () => selectedWeekRequests.some(request =>
          request.positions.some(position => position.id === expectedPositionId)
        ),
        `the selected-week request for slider value ${week}`,
      );
      await page.waitForFunction(
        expected => document.querySelector('[data-testid="timeline-slider"] [role="slider"]')?.getAttribute("aria-valuenow") === String(expected),
        {},
        week,
      );
      coordinatesByWeek.set(
        week,
        await waitForVendorCoordinates(
          page,
          week === historicalTestWeeks[0] ? selectedScores.old : selectedScores.new,
        ),
      );
      requestsByWeek.set(week, selectedWeekRequests.find(request =>
        request.positions.some(position => position.id === expectedPositionId)
      ));
    }

    assert.equal(selectedWeekRequests.length >= 2, true, "each selected week should issue a dated request");
    assert.notEqual(
      requestsByWeek.get(historicalTestWeeks[0]).date,
      requestsByWeek.get(historicalTestWeeks[1]).date,
      "selected weeks should request different dates",
    );
    assert.notDeepEqual(
      coordinatesByWeek.get(historicalTestWeeks[0]),
      coordinatesByWeek.get(historicalTestWeeks[1]),
      "vendor coordinates should change between selected weeks",
    );
    const expectedByWeek: Array<[number, { execution: number; viability: number }]> = [
      [historicalTestWeeks[0], selectedScores.old],
      [historicalTestWeeks[1], selectedScores.new],
    ];
    for (const [week, scores] of expectedByWeek) {
      const coordinates = coordinatesByWeek.get(week);
      assert.ok(coordinates, `coordinates should have been captured for week ${week}`);
      const { x: expectedX, y: expectedY } = expectedPixel(scores, coordinates.width, coordinates.height);
      assert.ok(
        Math.abs(coordinates.x - expectedX) < 0.1,
        `week ${week} execution score should reach the rendered x coordinate (${JSON.stringify({ coordinates, expectedX })})`,
      );
      assert.ok(
        Math.abs(coordinates.y - expectedY) < 0.1,
        `week ${week} viability score should reach the rendered y coordinate (${JSON.stringify({ coordinates, expectedY })})`,
      );
    }
    assert.equal(allHistoryRequests.length, 1, "the all-history trajectory request should remain independent");
    assert.equal(allHistoryRequests[0].positions.some(position => position.vendorId === vendorId), true);

    console.log("Historical slider browser regression passed.");
    await setSliderValue(page, 26);
    await verifyDesktopZoom(browser, page, vendorId, baseUrl, marketSlug);
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});