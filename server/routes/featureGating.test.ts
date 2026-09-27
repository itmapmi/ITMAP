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
  // isUuid/getMarketResearchReports/listMarketBuilderJobsForUserWithStageSummaries
  // are called unconditionally by requireMarketAccess and by handlers a granted
  // user reaches past the feature gate — leaving them unmocked doesn't fail a
  // gating test (it just yields a 500, which a "not 403" assertion still
  // accepts), but it silently masks whether those routes actually work.
  const storage: any = {
    getMarketById: vi.fn(),
    getResearchReportById: vi.fn(),
    getResearchReportsByMarket: vi.fn().mockResolvedValue([]),
    getMarketResearchReports: vi.fn().mockResolvedValue([]),
    createResearchReport: vi.fn(),
    getVendorSignalsByMarket: vi.fn().mockResolvedValue([]),
    isUuid: vi.fn().mockReturnValue(true),
    listMarketBuilderJobsForUserWithStageSummaries: vi.fn().mockResolvedValue([]),
  };
  const objectStorage = {
    normalizeObjectEntityPath: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
  };
  class ObjectStorageService {
    normalizeObjectEntityPath(rawPath: string) {
      return objectStorage.normalizeObjectEntityPath(rawPath);
    }

    getSignedDownloadUrl(storageKey: string, ttlSec: number) {
      return objectStorage.getSignedDownloadUrl(storageKey, ttlSec);
    }
  }
  return { mod, valueProxy, storage, objectStorage, ObjectStorageService };
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
vi.mock("../objectStorage", () => ({
  ObjectStorageService: h.ObjectStorageService,
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));
vi.mock("./leadGen", () => ({ recordEvent: vi.fn() }));
vi.mock("../pdf-generator/pdf-service", () => ({ pdfService: h.valueProxy() }));
vi.mock("../market-builder/runner", () =>
  h.mod("initSSE", "sendEvent", "runSingleStage", "buildLLMConfig", "MissingLlmKeyError"),
);
vi.mock("../market-builder/sources", () => h.mod("fetchUrlContent"));
vi.mock("../market-builder/inflight", () => h.mod("listInFlightVendors"));
vi.mock("../storage/signals", () => h.mod("getVendorSignals"));
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
type TestUser =
  | { id: string; role: string; featureAccess: string[]; vendorScopeId?: string }
  | null;
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
// A vendor-scoped seat (vendorScopeId set) is the only account shape whose
// access to a *non*-vendor-free lockable feature actually depends on
// featureAccess (see shared/features.ts hasFeatureAccess). A plain buyer
// (role "user", no vendorScopeId/persona) always passes requireFeature
// regardless of featureAccess by design — that's what lets a signed-up buyer
// use every feature without an admin grant. Testing the grant-denial path
// with a buyer fixture is a no-op: it always falls through requireFeature
// and simply exercises whatever mocking the downstream handler happens to
// have, which is what previously made these tests flaky/misleading.
const userWithout = (without: string): TestUser => ({
  id: "u1",
  role: "user",
  vendorScopeId: "v1",
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
  vendorScopeId: "v1",
  featureAccess: [feature],
});
const admin: TestUser = { id: "a1", role: "admin", featureAccess: [] };

// Each gated route family: a representative gated GET path + its feature key.
// Excludes "news" and "intelligence_feed" (vendor-signals) — both are in
// VENDOR_FREE_FEATURES, so no authenticated user (buyer or vendor-scoped) can
// ever be FEATURE_LOCKED out of them; see the "teaser-readable" block below.
const FAMILIES: { name: string; feature: string; path: string }[] = [
  { name: "market-builder", feature: "market_builder", path: "/api/market-builder/jobs" },
  { name: "forecast-builder", feature: "forecast_builder", path: "/api/forecast-builder/forecasts" },
  { name: "rfps", feature: "rfp", path: "/api/me/rfps" },
  { name: "datasheets", feature: "datasheets", path: "/api/me/datasheet-comparisons" },
  { name: "research-reports", feature: "research_reports", path: "/api/markets/m1/research-reports" },
  { name: "research-reports (legacy)", feature: "research_reports", path: "/api/markets/m1/reports" },
];

// "news" (GET /api/news listing) and "intelligence_feed" (vendor-signals) are
// intentionally anonymous-readable during the client's registration teaser
// window (see .agents/memory/intelligence-feed-teaser-access.md), and both
// are VENDOR_FREE_FEATURES — free for every vendor seat once signed in, on
// top of the buyer bypass. So there is no reachable state where an
// authenticated user gets 403 FEATURE_LOCKED on these routes; the real
// boundary is "anon gets the teaser preview, not a hard 401".
const TEASER_READABLE_FAMILIES: { name: string; feature: string; path: string }[] = [
  { name: "news", feature: "news", path: "/api/news" },
  { name: "vendor-signals", feature: "intelligence_feed", path: "/api/markets/m1/vendor-signals" },
];

beforeEach(() => {
  currentUser = null;
  vi.clearAllMocks();
  // Default storage behavior: a readable public market with no nested data.
  h.storage.getMarketById.mockResolvedValue({ id: "m1", visibility: "public" });
  h.storage.getResearchReportsByMarket.mockResolvedValue([]);
  h.storage.getVendorSignalsByMarket.mockResolvedValue([]);
  h.objectStorage.normalizeObjectEntityPath.mockImplementation((value: string) => value);
  h.objectStorage.getSignedDownloadUrl.mockResolvedValue(
    "https://storage.googleapis.com/signed-download",
  );
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

describe.each(TEASER_READABLE_FAMILIES)("teaser-readable route family: $name", ({ feature, path }) => {
  it("lets anonymous visitors read the teaser preview instead of a hard 401", async () => {
    currentUser = anon;
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });

  it("is not FEATURE_LOCKED for a vendor-scoped user without the grant (vendor-free feature)", async () => {
    currentUser = userWithout(feature);
    const res = await request(app).get(path);
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe("FEATURE_LOCKED");
  });

  it("lets a granted user through", async () => {
    currentUser = userWith(feature);
    const res = await request(app).get(path);
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe("FEATURE_LOCKED");
  });

  it("lets an admin through", async () => {
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

describe("research report App Storage URLs", () => {
  it("redirects an authorized download to a short-lived signed GET URL", async () => {
    currentUser = userWith("research_reports");
    h.storage.getResearchReportById.mockResolvedValue({
      id: "r1",
      marketId: "m1",
      title: "Report",
      fileUrl:
        "https://storage.googleapis.com/reports-bucket/uploads/report.pdf?temporary-put-signature",
    });
    h.storage.getMarketById.mockResolvedValue({ id: "m1", visibility: "public" });
    h.objectStorage.normalizeObjectEntityPath.mockReturnValue(
      "/objects/uploads/report.pdf",
    );
    h.objectStorage.getSignedDownloadUrl.mockResolvedValue(
      "https://storage.googleapis.com/signed-get-url",
    );

    const res = await request(app).get("/api/research-reports/r1/download");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://storage.googleapis.com/signed-get-url",
    );
    expect(h.objectStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      "/objects/uploads/report.pdf",
      15 * 60,
    );
  });

  it("stores a stable private object key instead of the temporary upload URL", async () => {
    currentUser = admin;
    h.objectStorage.normalizeObjectEntityPath.mockReturnValue(
      "/objects/uploads/report.pdf",
    );
    h.storage.createResearchReport.mockImplementation(async (report: any) => ({
      id: "r1",
      ...report,
    }));

    const res = await request(app).post("/api/research-reports").send({
      title: "Report",
      marketId: "m1",
      fileUrl:
        "https://storage.googleapis.com/reports-bucket/uploads/report.pdf?temporary-put-signature",
    });

    expect(res.status).toBe(201);
    expect(h.storage.createResearchReport).toHaveBeenCalledWith(
      expect.objectContaining({
        fileUrl: "/objects/uploads/report.pdf",
      }),
    );
  });
});
