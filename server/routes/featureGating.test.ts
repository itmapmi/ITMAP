import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mock the data + side-effect layers so handlers never touch the DB or any
// external service. We only need real code paths through requireFeature (the
// subject under test) and the real auth middleware; everything downstream is
// stubbed. We must list the named exports explicitly because ESM static imports
// resolve bindings at link time (a Proxy factory would leave them undefined).
const h = vi.hoisted(() => {
  // Build a module object whose named exports are all no-op vi.fns returning [].
  const mod = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, vi.fn().mockReturnValue([])]));
  // A runtime value object (e.g. `newsStorage`, `pdfService`) whose methods are
  // all no-op fns — safe because it's accessed by property at call time.
  const valueProxy = () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) });

  // The aggregate `storage` object needs a handful of explicitly controllable
  // methods so the research-report visibility test can drive return values.
  const storage: any = {
    getMarketById: vi.fn(),
    getResearchReportById: vi.fn(),
    getResearchReportsByMarket: vi.fn().mockResolvedValue([]),
    getVendorSignalsByMarket: vi.fn().mockResolvedValue([]),
  };
  return { mod, valueProxy, storage };
});

vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("../storage/marketBuilder", () =>
  h.mod("listMarketBuilderJobsWithStageSummaries"),
);
vi.mock("../storage/forecasts", () =>
  h.mod(
    "createForecast", "listForecasts", "listForecastsForUser", "getForecast",
    "getForecastFull", "updateForecast", "deleteForecast", "upsertForecastBoundary",
    "getForecastBoundary", "getForecastBrief", "upsertForecastBrief", "clearForecastBrief",
    "getForecastAssumptions", "updateForecastAssumption", "createForecastSource",
    "getForecastSource", "deleteForecastSource", "getForecastVersionNumbers",
  ),
);
vi.mock("../storage/userLlmKeys", () => h.mod("getUserLlmApiKey"));
vi.mock("../storage/rfps", () =>
  h.mod(
    "createRfpProject", "getRfpProject", "getRfpProjectForOwner",
    "listRfpProjectsForUser", "listRfpProjectsForUserAndMarket", "updateRfpProject",
    "deleteRfpProject", "countActiveRfpsForUser", "listAllRfpProjectsWithMeta",
    "listRfpMessages", "appendRfpMessage", "listRfpRequirements", "createRfpRequirement",
    "updateRfpRequirement", "deleteRfpRequirement", "bulkCreateRfpRequirements",
    "clearRfpRequirements", "listRfpSections", "upsertRfpSection", "updateRfpSection",
    "clearRfpSections", "listRfpShortlist", "bulkCreateRfpShortlist", "clearRfpShortlist",
    "updateRfpShortlistEntry", "listRfpOutreach", "upsertRfpOutreach", "deleteRfpOutreach",
    "countRfpsCreatedLast24hForUser",
  ),
);
vi.mock("../storage/datasheets", () =>
  h.mod(
    "listDatasheetMarkets", "getDatasheetMarket", "getDatasheetMarketBySlug",
    "createDatasheetMarket", "updateDatasheetMarket", "deleteDatasheetMarket",
    "listDatasheetVendors", "getDatasheetVendor", "createDatasheetVendor",
    "updateDatasheetVendor", "deleteDatasheetVendor", "listProductsByMarket", "getProduct",
    "getProductsByIds", "createProduct", "updateProduct", "deleteProduct", "getDatasheet",
    "getCurrentDatasheetForProduct", "getCurrentDatasheetsForProducts",
    "listDatasheetsForProduct", "createDatasheet", "updateDatasheet", "unsetCurrentDatasheets",
    "getNextVersionForProduct", "listSpecsForDatasheet", "listSpecsForDatasheets",
    "replaceSpecsForDatasheet", "updateSpec", "listSpecsNeedingReview", "listComparisonsForUser",
    "getComparisonForOwner", "createComparison", "updateComparisonForOwner",
    "deleteComparisonForOwner", "createChangeAlert", "listChangeAlertsForMarket",
    "listChatConversationsForUser", "getChatConversationForOwner", "createChatConversation",
    "updateChatConversation", "deleteChatConversationForOwner", "listChatMessages",
    "appendChatMessage",
  ),
);
vi.mock("../objectStorage", () => h.mod("ObjectStorageService", "ObjectNotFoundError"));
vi.mock("../pdf-generator/pdf-service", () => ({ pdfService: h.valueProxy() }));
vi.mock("../market-builder/runner", () =>
  h.mod("initSSE", "sendEvent", "runSingleStage", "buildLLMConfig", "MissingLlmKeyError"),
);
vi.mock("../market-builder/sources", () => h.mod("fetchUrlContent"));
vi.mock("../market-builder/inflight", () => h.mod("listInFlightVendors"));
vi.mock("../forecast/audit", () => h.mod("writeAuditEntry"));
vi.mock("../forecast/recalculate", () => h.mod("rebuildAndPersistEngine"));
vi.mock("../forecast/targeted-challenge", () => h.mod("runTargetedChallenge"));
vi.mock("../forecast/phases/phase1", () => h.mod("extractBoundary"));
vi.mock("../forecast/phases/phase2", async () => {
  const { z } = await import("zod");
  return {
    ...h.mod("getNextQuestion", "getDefaultForQuestion", "getSkipConsequence", "assembleBrief"),
    answerEntrySchema: z.object({}).passthrough(),
  };
});
vi.mock("../forecast/phases/debate-runner", () => h.mod("runDebate"));
vi.mock("../rfp/context", () => h.mod("buildRfpMarketContext"));
vi.mock("../rfp/llm", () => h.mod("getRfpLlmClient", "MissingLlmKeyError"));
vi.mock("../rfp/interview", () =>
  h.mod(
    "REQUIRED_SLOTS", "nextMissingSlot", "buildInterviewSystemPrompt", "buildExtractionPrompt",
    "profileReadiness", "normalizeCustomerProfile", "isNegationAnswer", "applyNegationToSlot",
    "isSlotFilled",
  ),
);
vi.mock("../rfp/generator", () =>
  h.mod(
    "generateRfp", "generateRfpSection", "seedRequirementsFromProfile",
    "enrichShortlistRationales", "renderFullMarkdown",
  ),
);
vi.mock("../rfp/scorer", () => h.mod("scoreVendors"));
vi.mock("../rfp/exports", () => h.mod("exportRfpPdf", "exportRfpDocx", "exportRfpXlsx"));
vi.mock("../datasheets/extractor", () => h.mod("extractDatasheet"));
vi.mock("../datasheets/schemaInference", () => h.mod("inferSchemaFromPdfs"));
vi.mock("../datasheets/diff", () => h.mod("diffSpecs"));
vi.mock("../datasheets/chat", () => h.mod("generateDatasheetChatResponse"));
vi.mock("../news/storage", () => ({ newsStorage: h.valueProxy() }));
vi.mock("../news/ingestion/scraper", () => h.mod("scrapeAllVendors", "scrapeSingleVendor"));
vi.mock("../news/impact/analyzer", () => h.mod("analyzeAllPending", "analyzeSingleArticle"));

import { registerMarketRoutes } from "./markets";
import { registerFileRoutes } from "./files";
import { registerNewsRoutes } from "./news";
import { registerMarketBuilderRoutes } from "./marketBuilder";
import { registerForecastBuilderRoutes } from "./forecastBuilder";
import { registerRfpRoutes } from "./rfps";
import { registerDatasheetRoutes } from "./datasheets";

// Mutable auth context applied to every request by an injected middleware.
type TestUser = { id: string; role: string; featureAccess: string[] } | null;
let currentUser: TestUser = null;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => currentUser !== null;
    req.user = currentUser ?? undefined;
    next();
  });
  registerMarketRoutes(app);
  registerFileRoutes(app);
  registerNewsRoutes(app);
  registerMarketBuilderRoutes(app);
  registerForecastBuilderRoutes(app);
  registerRfpRoutes(app);
  registerDatasheetRoutes(app);
  return app;
}

const app = buildApp();

const anon: TestUser = null;
const userWithout = (without: string): TestUser => ({
  id: "u1",
  role: "user",
  featureAccess: [
    "market_builder",
    "forecast_builder",
    "research_reports",
    "datasheets",
    "rfp",
    "news",
    "intelligence_feed",
  ].filter((f) => f !== without),
});
const userWith = (feature: string): TestUser => ({
  id: "u1",
  role: "user",
  featureAccess: [feature],
});
const admin: TestUser = { id: "a1", role: "admin", featureAccess: [] };

// Each gated route family: a representative gated GET path + its feature key.
const FAMILIES: { name: string; feature: string; path: string }[] = [
  { name: "market-builder", feature: "market_builder", path: "/api/market-builder/jobs" },
  { name: "forecast-builder", feature: "forecast_builder", path: "/api/forecast-builder/forecasts" },
  { name: "rfps", feature: "rfp", path: "/api/me/rfps" },
  { name: "news", feature: "news", path: "/api/news" },
  { name: "datasheets", feature: "datasheets", path: "/api/me/datasheet-comparisons" },
  { name: "vendor-signals", feature: "intelligence_feed", path: "/api/markets/m1/vendor-signals" },
  { name: "research-reports", feature: "research_reports", path: "/api/markets/m1/research-reports" },
  { name: "research-reports (legacy)", feature: "research_reports", path: "/api/markets/m1/reports" },
];

beforeEach(() => {
  currentUser = null;
  vi.clearAllMocks();
  // Default storage behavior: a readable public market with no nested data.
  h.storage.getMarketById.mockResolvedValue({ id: "m1", visibility: "public" });
  h.storage.getResearchReportsByMarket.mockResolvedValue([]);
  h.storage.getVendorSignalsByMarket.mockResolvedValue([]);
});

describe.each(FAMILIES)("gated route family: $name", ({ feature, path }) => {
  it("rejects unauthenticated requests with 401", async () => {
    currentUser = anon;
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it("rejects authenticated users without the grant with 403 FEATURE_LOCKED", async () => {
    currentUser = userWithout(feature);
    const res = await request(app).get(path);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_LOCKED");
    expect(res.body.feature).toBe(feature);
  });

  it("lets a granted user past the feature gate", async () => {
    currentUser = userWith(feature);
    const res = await request(app).get(path);
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe("FEATURE_LOCKED");
  });

  it("lets an admin past the feature gate", async () => {
    currentUser = admin;
    const res = await request(app).get(path);
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe("FEATURE_LOCKED");
  });
});

describe("GET /api/research-reports/:reportId visibility enforcement", () => {
  beforeEach(() => {
    h.storage.getResearchReportById.mockResolvedValue({ id: "r1", marketId: "m1" });
    h.storage.getMarketById.mockResolvedValue({
      id: "m1",
      visibility: "private",
      ownerUserId: "owner1",
    });
  });

  it("returns 401 when unauthenticated (feature gate first)", async () => {
    currentUser = anon;
    const res = await request(app).get("/api/research-reports/r1");
    expect(res.status).toBe(401);
  });

  it("returns 403 FEATURE_LOCKED when the user lacks research_reports", async () => {
    currentUser = userWithout("research_reports");
    const res = await request(app).get("/api/research-reports/r1");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_LOCKED");
  });

  it("hides a private-market report from a granted non-owner (404)", async () => {
    currentUser = userWith("research_reports"); // id u1, not owner1
    const res = await request(app).get("/api/research-reports/r1");
    expect(res.status).toBe(404);
  });

  it("returns the report to the private-market owner", async () => {
    currentUser = { id: "owner1", role: "user", featureAccess: ["research_reports"] };
    const res = await request(app).get("/api/research-reports/r1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("r1");
  });

  it("returns the report to an admin even when not the owner", async () => {
    currentUser = admin;
    const res = await request(app).get("/api/research-reports/r1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("r1");
  });
});
