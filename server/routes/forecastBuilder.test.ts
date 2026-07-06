import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Hoist mocks so vi.mock factory refs are stable ───────────────────────────
const h = vi.hoisted(() => {
  const fn = () => vi.fn().mockResolvedValue(undefined);
  const mod = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, fn()]));
  const valueProxy = () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });

  // Storage fns we need to drive from tests
  const forecasts = {
    createForecast: vi.fn().mockResolvedValue({}),
    listForecasts: vi.fn().mockResolvedValue([]),
    listForecastsForUser: vi.fn().mockResolvedValue([]),
    getForecast: vi.fn(),
    getForecastFull: vi.fn().mockResolvedValue(null),
    updateForecast: vi.fn().mockResolvedValue({}),
    deleteForecast: vi.fn().mockResolvedValue({}),
    upsertForecastBoundary: vi.fn().mockResolvedValue({}),
    getForecastBoundary: vi.fn(),
    getForecastBrief: vi.fn(),
    upsertForecastBrief: vi.fn().mockResolvedValue({}),
    clearForecastBrief: vi.fn().mockResolvedValue({}),
    getForecastAssumptions: vi.fn().mockResolvedValue([]),
    updateForecastAssumption: vi.fn().mockResolvedValue({}),
    createForecastSource: vi.fn().mockResolvedValue({}),
    getForecastSource: vi.fn().mockResolvedValue(null),
    deleteForecastSource: vi.fn().mockResolvedValue({}),
    getForecastVersionNumbers: vi.fn().mockResolvedValue({}),
  };

  const audit = {
    writeAuditEntry: vi.fn().mockResolvedValue(undefined),
  };

  const userLlmKeys = {
    getUserLlmApiKey: vi.fn().mockResolvedValue(undefined),
  };

  const runDebate = vi.fn().mockResolvedValue(undefined);

  return { mod, valueProxy, forecasts, audit, userLlmKeys, runDebate };
});

vi.mock("../storage/forecasts", () => h.forecasts);
vi.mock("../forecast/audit", () => h.audit);
vi.mock("../storage/userLlmKeys", () => h.userLlmKeys);
vi.mock("../forecast/phases/debate-runner", () => ({ runDebate: h.runDebate }));
vi.mock("../forecast/recalculate", () => h.mod("rebuildAndPersistEngine"));
vi.mock("../forecast/targeted-challenge", () => h.mod("runTargetedChallenge"));
vi.mock("../forecast/phases/phase1", () => ({
  ...h.mod("extractBoundary"),
  // MarketType is a string union — no runtime value needed
}));
vi.mock("../forecast/phases/phase2", async () => {
  const { z } = await import("zod");
  return {
    ...h.mod("getNextQuestion", "getDefaultForQuestion", "getSkipConsequence", "assembleBrief"),
    answerEntrySchema: z.object({}).passthrough(),
  };
});
vi.mock("../forecast/phases/phase4", () => h.mod("runBuildPipeline"));
vi.mock("../pdf-generator/pdf-service", () => ({ pdfService: h.valueProxy() }));
vi.mock("../forecast/pptx", () => h.mod("buildForecastPptx"));

// ── App setup ─────────────────────────────────────────────────────────────────

import { registerForecastBuilderRoutes } from "./forecastBuilder";

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
  registerForecastBuilderRoutes(app);
  return app;
}

const app = buildApp();

const forecastUser: TestUser = {
  id: "u1",
  role: "user",
  featureAccess: ["forecast_builder"],
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_FORECAST = {
  id: "f1",
  createdBy: "u1",
  title: "Test Forecast",
  status: "draft",
  baseYear: 2024,
  forecastHorizonYears: 5,
  currency: "USD",
  error: null,
};

const BASE_BOUNDARY = {
  id: "b1",
  forecastId: "f1",
  includedCategories: ["servers"],
  excludedCategories: [],
  geographicScope: "Global",
  unitOfMeasurement: "$B revenue",
  timeHorizon: "2024–2029",
  marketType: "software_saas",
  confirmedByUser: false,
  proposedBySystem: null,
  userEdits: null,
};

const BASE_BRIEF = {
  id: "br1",
  forecastId: "f1",
  purpose: "Internal strategy / planning",
  confidenceLevel: "directional",
  methodologyPreference: "hybrid",
  drivers: [],
  discontinuities: [],
  adjacentMarkets: [],
  outputFormat: "Bull / base / bear scenarios",
  sourceRequirements: "Any credible sources",
};

beforeEach(() => {
  currentUser = null;
  vi.clearAllMocks();
  // Restore default mock return values after clearAllMocks
  h.forecasts.getForecast.mockResolvedValue(BASE_FORECAST);
  h.forecasts.getForecastBoundary.mockResolvedValue(BASE_BOUNDARY);
  h.forecasts.getForecastBrief.mockResolvedValue(BASE_BRIEF);
  h.forecasts.upsertForecastBoundary.mockResolvedValue(BASE_BOUNDARY);
  h.forecasts.updateForecast.mockResolvedValue({});
  h.forecasts.getForecastVersionNumbers.mockResolvedValue({});
  h.audit.writeAuditEntry.mockResolvedValue(undefined);
  h.userLlmKeys.getUserLlmApiKey.mockResolvedValue(undefined);
  h.runDebate.mockResolvedValue(undefined);
});

// ── confirm-boundary: marketType override is persisted ───────────────────────

describe("POST /api/forecast-builder/forecasts/:id/confirm-boundary", () => {
  it("persists hardware_infrastructure when user overrides marketType", async () => {
    currentUser = forecastUser;

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/confirm-boundary")
      .send({ edits: { marketType: "hardware_infrastructure" } });

    expect(res.status).toBe(200);

    // Verify the boundary was upserted with the user-supplied marketType
    expect(h.forecasts.upsertForecastBoundary).toHaveBeenCalledOnce();
    const [, boundaryPayload] = h.forecasts.upsertForecastBoundary.mock.calls[0];
    expect(boundaryPayload.marketType).toBe("hardware_infrastructure");
  });

  it("persists hybrid when user overrides marketType to hybrid", async () => {
    currentUser = forecastUser;

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/confirm-boundary")
      .send({ edits: { marketType: "hybrid" } });

    expect(res.status).toBe(200);

    const [, boundaryPayload] = h.forecasts.upsertForecastBoundary.mock.calls[0];
    expect(boundaryPayload.marketType).toBe("hybrid");
  });

  it("falls back to existing boundary marketType when no override is provided", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "services",
    });

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/confirm-boundary")
      .send({});

    expect(res.status).toBe(200);

    const [, boundaryPayload] = h.forecasts.upsertForecastBoundary.mock.calls[0];
    expect(boundaryPayload.marketType).toBe("services");
  });

  it("rejects an invalid marketType value with 400", async () => {
    currentUser = forecastUser;

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/confirm-boundary")
      .send({ edits: { marketType: "made_up_type" } });

    expect(res.status).toBe(400);
  });
});

// ── debate/start: analystCExpected reflects boundary marketType ───────────────

describe("POST /api/forecast-builder/forecasts/:id/debate/start", () => {
  const OPENAI_KEY_BACKUP = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  beforeEach(() => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
    // debate/start requires status="brief_complete"
    h.forecasts.getForecast.mockResolvedValue({
      ...BASE_FORECAST,
      status: "brief_complete",
    });
  });

  afterEach(() => {
    if (OPENAI_KEY_BACKUP === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = OPENAI_KEY_BACKUP;
    }
  });

  it("sets analystCExpected=true when boundary marketType is hardware_infrastructure", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "hardware_infrastructure",
      confirmedByUser: true,
    });

    // debate/start responds via SSE — use a request that tolerates streaming
    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start")
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => callback(null, data));
      });

    // Verify the audit entry captured analystCExpected=true
    expect(h.audit.writeAuditEntry).toHaveBeenCalledWith(
      "f1",
      "debate_started",
      "u1",
      expect.objectContaining({ analystCExpected: true }),
    );
  });

  it("sets analystCExpected=true when boundary marketType is hybrid", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "hybrid",
      confirmedByUser: true,
    });

    await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start")
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => callback(null, data));
      });

    expect(h.audit.writeAuditEntry).toHaveBeenCalledWith(
      "f1",
      "debate_started",
      "u1",
      expect.objectContaining({ analystCExpected: true }),
    );
  });

  it("sets analystCExpected=false when boundary marketType is software_saas", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "software_saas",
      confirmedByUser: true,
    });

    await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start")
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => callback(null, data));
      });

    expect(h.audit.writeAuditEntry).toHaveBeenCalledWith(
      "f1",
      "debate_started",
      "u1",
      expect.objectContaining({ analystCExpected: false }),
    );
  });

  it("sets analystCExpected=false when boundary marketType is services", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "services",
      confirmedByUser: true,
    });

    await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start")
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => callback(null, data));
      });

    expect(h.audit.writeAuditEntry).toHaveBeenCalledWith(
      "f1",
      "debate_started",
      "u1",
      expect.objectContaining({ analystCExpected: false }),
    );
  });

  it("returns 400 when boundary is not confirmed by user", async () => {
    currentUser = forecastUser;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      marketType: "hardware_infrastructure",
      confirmedByUser: false,
    });

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start");

    expect(res.status).toBe(400);
    expect(h.audit.writeAuditEntry).not.toHaveBeenCalled();
  });

  it("returns 503 when OpenAI key is absent", async () => {
    currentUser = forecastUser;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    h.forecasts.getForecastBoundary.mockResolvedValue({
      ...BASE_BOUNDARY,
      confirmedByUser: true,
    });

    const res = await request(app)
      .post("/api/forecast-builder/forecasts/f1/debate/start");

    expect(res.status).toBe(503);
    expect(h.audit.writeAuditEntry).not.toHaveBeenCalled();
  });
});
