import dotenv from "dotenv";
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { runStartupMigrations } from "./db";

const app = express();

// Trust proxy for HTTPS detection in Replit environment
app.set('trust proxy', true);

// Redirect .replit.app domain to custom domain
app.use((req, res, next) => {
  const host = req.get('host');
  
  // If accessing via .replit.app domain, redirect to custom domain
  if (host && host.includes('.replit.app')) {
    // Use BASE_URL if available, otherwise prefer custom domain over .replit.app
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      const domains = process.env.REPLIT_DOMAINS?.split(',') || [];
      const customDomain = domains.find(d => !d.includes('.replit.app'));
      if (customDomain) {
        baseUrl = `https://${customDomain}`;
      }
    }
    
    // Only redirect if we have a valid custom domain
    if (baseUrl) {
      const newUrl = `${baseUrl}${req.originalUrl}`;
      return res.redirect(301, newUrl);
    }
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

  // Seed Market Builder system default prompts (idempotent)
  try {
    const { seedSystemPrompts } = await import("./market-builder/prompts");
    await seedSystemPrompts();
  } catch (err) {
    log("Warning: Could not seed Market Builder system prompts:", String(err));
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
