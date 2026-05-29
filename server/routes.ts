import type { Express } from "express";
import { createServer, type Server } from "http";
import { externalRouter } from "./external";
import { registerAuthRoutes } from "./routes/auth";
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

export async function registerRoutes(app: Express): Promise<Server> {
  // External partner API (API-key auth, no session required) — must come first
  app.use('/api/external', externalRouter);

  // Domain modules
  registerAuthRoutes(app);
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

  return createServer(app);
}
