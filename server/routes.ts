import type { Express } from "express";
import { createServer, type Server } from "http";
import { externalRouter } from "./external";
import { registerAuthRoutes } from "./routes/auth";
import { registerLegalRoutes } from "./routes/legal";
import { registerMarketRoutes } from "./routes/markets";
import { registerFileRoutes } from "./routes/files";
import { registerNewsRoutes } from "./routes/news";
import { registerChatRoutes } from "./routes/chat";
import { registerAdminRoutes } from "./routes/admin";
import { registerMarketBuilderRoutes } from "./routes/marketBuilder";
import { registerMeRoutes } from "./routes/me";
import { registerForecastBuilderRoutes } from "./routes/forecastBuilder";
import { registerRfpRoutes } from "./routes/rfps";
import { registerDatasheetRoutes } from "./routes/datasheets";
import { registerDatasheetPhase2Routes } from "./routes/datasheetsPhase2";
import { registerLeadGenRoutes } from "./routes/leadGen";
import { registerRfpKbRoutes } from "./routes/rfpKb";
import { registerRfpResponderRoutes } from "./routes/rfpResponder";
import { registerRfpDiagramRoutes } from "./routes/rfpDiagrams";
import { registerRfpAssemblyRoutes } from "./routes/rfpAssembly";
import { registerBattleCardRoutes } from "./routes/battleCards";
import { registerCveRoutes } from "./routes/cve";
import { registerContactRoutes } from "./routes/contact";
import { registerMarketTrendsRoutes } from "./routes/marketTrends";
import { registerGeoLanguageRoutes } from "./routes/geoLanguage";
import { warmAllMarkets, startCacheRefreshTimer } from "./chat/context-cache";

export async function registerRoutes(app: Express): Promise<Server> {
  // External partner API (API-key auth, no session required) — must come first
  app.use('/api/external', externalRouter);

  // Domain modules
  registerAuthRoutes(app);
  registerLegalRoutes(app);
  registerMarketRoutes(app);
  registerFileRoutes(app);
  registerNewsRoutes(app);
  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerMarketBuilderRoutes(app);
  registerMeRoutes(app);
  registerForecastBuilderRoutes(app);
  registerRfpRoutes(app);
  registerDatasheetRoutes(app);
  registerDatasheetPhase2Routes(app);
  registerLeadGenRoutes(app);
  registerRfpKbRoutes(app);
  registerRfpResponderRoutes(app);
  registerRfpDiagramRoutes(app);
  registerRfpAssemblyRoutes(app);
  registerBattleCardRoutes(app);
  registerCveRoutes(app);
  registerContactRoutes(app);
  registerMarketTrendsRoutes(app);
  registerGeoLanguageRoutes(app);

  // Warm the AI chat context cache in the background so the first user message
  // on any public market is served from cache, not rebuilt from scratch.
  setTimeout(() => {
    warmAllMarkets().catch((e) => console.warn("[Startup] warmAllMarkets failed:", e));
    startCacheRefreshTimer();
  }, 5000); // 5-second delay so DB is fully ready before cache build starts

  return createServer(app);
}
