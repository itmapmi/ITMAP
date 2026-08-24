import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const baseUrl = process.env.MAGIC_QUADRANT_TEST_BASE_URL || "http://127.0.0.1:5000";
const marketSlug = "historical-browser-fixture";
const marketId = "historical-browser-fixture";
const vendorId = "vendor-alpha";
const dayMs = 24 * 60 * 60 * 1000;

const market = {
  id: marketId,
  name: "Historical Browser Fixture",
  description: "Fixture market for the historical slider browser regression test.",
  visibility: "public",
  isVisible: true,
  marketType: "mature",
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
    executionScore: "15",
    viabilityScore: "25",
    recordedAt: new Date(Date.now() - 730 * dayMs).toISOString(),
  },
  {
    id: "history-alpha-new",
    vendorId,
    marketId,
    executionScore: "75",
    viabilityScore: "65",
    recordedAt: new Date(Date.now() - 365 * dayMs).toISOString(),
  },
  {
    id: "history-beta-old",
    vendorId: "vendor-beta",
    marketId,
    executionScore: "85",
    viabilityScore: "75",
    recordedAt: new Date(Date.now() - 730 * dayMs).toISOString(),
  },
  {
    id: "history-beta-new",
    vendorId: "vendor-beta",
    marketId,
    executionScore: "25",
    viabilityScore: "35",
    recordedAt: new Date(Date.now() - 365 * dayMs).toISOString(),
  },
];

const selectedWeekRequests = [];
const allHistoryRequests = [];

function selectedPositions(dateValue) {
  // Slider positions 52 and 104 are roughly two years and one year ago.
  // Use the date supplied by the browser so this remains stable across runs.
  const date = new Date(dateValue).getTime();
  const threshold = Date.now() - 548 * dayMs;
  const older = date < threshold;
  return older
    ? [
        { id: "selected-alpha-old", vendorId, marketId, executionScore: "20", viabilityScore: "30" },
        { id: "selected-beta-old", vendorId: "vendor-beta", marketId, executionScore: "80", viabilityScore: "70" },
      ]
    : [
        { id: "selected-alpha-new", vendorId, marketId, executionScore: "70", viabilityScore: "60" },
        { id: "selected-beta-new", vendorId: "vendor-beta", marketId, executionScore: "30", viabilityScore: "40" },
      ];
}

function jsonResponse(body) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function waitFor(predicate, description, timeoutMs = 10_000) {
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

async function setSliderValue(page, value) {
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

async function readVendorCoordinates(page) {
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

async function waitForVendorCoordinates(page, scores) {
  await page.waitForFunction(
    ({ vendorId: expectedVendorId, execution, viability }) => {
      const dot = document.querySelector(`[data-vendor-id="${expectedVendorId}"] .vendor-dot`);
      const svg = dot?.ownerSVGElement;
      if (!dot || !svg) return false;

      const width = Number(svg.getAttribute("width"));
      const height = Number(svg.getAttribute("height"));
      const expectedX = 60 + (execution / 100) * (width - 80);
      const expectedY = height - 82 - (viability / 100) * (height - 126);
      return Math.abs(Number(dot.getAttribute("cx")) - expectedX) < 0.1
        && Math.abs(Number(dot.getAttribute("cy")) - expectedY) < 0.1;
    },
    {},
    { vendorId, ...scores },
  );
  return readVendorCoordinates(page);
}

async function run() {
  const serverProcess = await ensureServer();
  const browser = await puppeteer.launch({ headless: true });
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

    const coordinatesByWeek = new Map();
    const requestsByWeek = new Map();
    for (const week of [52, 104]) {
      await setSliderValue(page, week);
      const expectedPositionId = week === 52 ? "selected-alpha-old" : "selected-alpha-new";
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
          week === 52 ? { execution: 20, viability: 30 } : { execution: 70, viability: 60 },
        ),
      );
      requestsByWeek.set(week, selectedWeekRequests.find(request =>
        request.positions.some(position => position.id === expectedPositionId)
      ));
    }

    assert.equal(selectedWeekRequests.length >= 2, true, "each selected week should issue a dated request");
    assert.notEqual(requestsByWeek.get(52).date, requestsByWeek.get(104).date, "selected weeks should request different dates");
    assert.notDeepEqual(coordinatesByWeek.get(52), coordinatesByWeek.get(104), "vendor coordinates should change between selected weeks");
    for (const [week, scores] of [[52, { execution: 20, viability: 30 }], [104, { execution: 70, viability: 60 }]]) {
      const coordinates = coordinatesByWeek.get(week);
      const expectedX = 60 + (scores.execution / 100) * (coordinates.width - 80);
      const expectedY = coordinates.height - 82 - (scores.viability / 100) * (coordinates.height - 126);
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