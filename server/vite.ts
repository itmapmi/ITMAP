import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import { renderPublicHtml } from "./seo";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      let page = await vite.transformIndexHtml(url, template);
      const rendered = await renderPublicHtml(page, url);
      res.status(rendered.status).set({
        "Content-Type": "text/html",
        "Cache-Control": "private, no-store",
        ...(rendered.indexable ? {} : { "X-Robots-Tag": "noindex, nofollow" }),
      }).end(rendered.html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      console.warn("[SEO] Public page rendering unavailable");
      res.status(503).set("Retry-After", "60").type("html")
        .send("<h1>ITMAP is temporarily unavailable</h1><p>Please try again shortly.</p>");
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // The homepage must pass through public rendering too, not be served as an
  // empty static index.html before the catch-all can run.
  app.get("/index.html", (req, res) => res.redirect(301, "/" + (req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "")));
  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist; inject per-route
  // SEO tags so crawlers see correct canonical/title/meta without JavaScript.
  const indexPath = path.resolve(distPath, "index.html");
  const baseHtml = fs.readFileSync(indexPath, "utf-8");
  app.use("*", async (req, res) => {
    try {
      const rendered = await renderPublicHtml(baseHtml, req.originalUrl);
      res.status(rendered.status).set({
        "Content-Type": "text/html",
        "Cache-Control": "private, no-store",
        ...(rendered.indexable ? {} : { "X-Robots-Tag": "noindex, nofollow" }),
      }).send(rendered.html);
    } catch {
      // Do not publish an empty 200 response (or a misleading 404) during a
      // database outage. A 503 tells crawlers to retry, not remove the page.
      console.warn("[SEO] Public page rendering unavailable");
      res.status(503).set("Retry-After", "60").type("html")
        .send("<h1>ITMAP is temporarily unavailable</h1><p>Please try again shortly.</p>");
    }
  });
}
