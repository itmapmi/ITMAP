import dotenv from "dotenv";
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { runStartupMigrations } from "./db";

const app = express();

// Trust proxy for HTTPS detection in Replit environment
app.set('trust proxy', true);

// Canonical domain enforcement.
// In production a custom domain (e.g. spectio.ai) is served alongside the bare
// Replit deployment domain (*.replit.app). Without this, an OAuth login can
// strand the user on the *.replit.app host. We 301-redirect any *.replit.app
// request to the primary custom domain so the whole session stays on one host.
// Dev/preview hosts use *.replit.dev and are never matched, so the preview pane
// keeps working.
const PRIMARY_DOMAIN = (process.env.PRIMARY_DOMAIN || "spectio.ai")
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .split(":")[0];
app.use((req, res, next) => {
  const host = (req.get("host") || "").toLowerCase().split(":")[0];
  if (PRIMARY_DOMAIN && host.endsWith(".replit.app") && host !== PRIMARY_DOMAIN) {
    return res.redirect(301, `https://${PRIMARY_DOMAIN}${req.originalUrl}`);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Apply any additive schema changes that may not have been db:pushed yet
  await runStartupMigrations();

  // Recover any stages left in "running" state from a previous server crash/deploy
  try {
    const { resetOrphanedRunningStages } = await import("./storage/marketBuilder");
    const recovered = await resetOrphanedRunningStages();
    if (recovered > 0) log(`[MarketBuilder] Recovered ${recovered} orphaned running stage(s) → idle`);
  } catch (err) {
    log("Warning: Could not reset orphaned Market Builder stages:", String(err));
  }

  // Startup banner: print the canonical Market Builder stage map so any future
  // deploy mismatch (e.g. server bundle from one commit, client bundle from
  // another) shows up in the deployment logs immediately.
  try {
    const { STAGE_NAMES } = await import("./market-builder/runner");
    const map = Object.entries(STAGE_NAMES)
      .map(([n, label]) => `${n}=${label}`)
      .join(", ");
    log(`[MarketBuilder] Stage map (server build): ${map}`);
  } catch (err) {
    log("Warning: Could not log Market Builder stage map:", String(err));
  }

  // Seed Market Builder system default prompts (idempotent)
  try {
    const { seedSystemPrompts } = await import("./market-builder/prompts");
    await seedSystemPrompts();
  } catch (err) {
    log("Warning: Could not seed Market Builder system prompts:", String(err));
  }

  // Seed Datasheet Comparison demo market (idempotent)
  try {
    const { seedDatasheets } = await import("./datasheets/seed");
    await seedDatasheets();
  } catch (err) {
    log("Warning: Could not seed datasheet market:", String(err));
  }

  // Verify Forecast calculation engine is functional (deterministic, no DB/LLM)
  try {
    const { smokeTest } = await import("./forecast/engine");
    smokeTest();
  } catch (err) {
    log("Warning: Forecast Engine smoke test failed:", String(err));
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Initialize and start cron jobs
  try {
    const { cronJobManager } = await import("./cronJobs");
    cronJobManager.initializeCronJobs();
    cronJobManager.startAllJobs();
    log("✓ Cron jobs initialized and started");

    // Catch-up: if the news pipeline hasn't run in >23 hours (e.g. due to a server
    // restart between cron windows), fire it immediately so no articles are missed.
    try {
      const { db } = await import("./db");
      const { newsFetchLogs } = await import("../shared/schema");
      const { desc } = await import("drizzle-orm");
      const [lastLog] = await db
        .select({ fetchedAt: newsFetchLogs.fetchedAt })
        .from(newsFetchLogs)
        .orderBy(desc(newsFetchLogs.fetchedAt))
        .limit(1);

      const hoursAgo = lastLog
        ? (Date.now() - new Date(lastLog.fetchedAt).getTime()) / 3_600_000
        : Infinity;

      if (hoursAgo > 23) {
        log(`[Startup] News pipeline last ran ${Math.round(hoursAgo)}h ago — triggering catch-up run...`);
        cronJobManager.runNewsIngestion().catch(err =>
          log('[Startup] Catch-up pipeline error:', String(err))
        );
      } else {
        log(`[Startup] News pipeline ran ${Math.round(hoursAgo)}h ago — no catch-up needed`);
      }
    } catch (catchUpErr) {
      log('[Startup] Could not check news pipeline catch-up:', String(catchUpErr));
    }

    // Graceful shutdown
    process.on('SIGTERM', () => {
      log('SIGTERM received, stopping cron jobs...');
      cronJobManager.stopAllJobs();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      log('SIGINT received, stopping cron jobs...');
      cronJobManager.stopAllJobs();
      process.exit(0);
    });
  } catch (error) {
    log('Warning: Could not initialize cron jobs:', String(error));
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
