import type { Express } from "express";
import { requireAdmin } from "../auth";
import { indexingInventory, RefreshBlocked } from "../searchConsole/store";
import { refreshInspections } from "../searchConsole/refresh";

export function registerSearchConsoleRoutes(app: Express) {
  app.get("/api/admin/search-console", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await indexingInventory()); }
    catch { res.status(500).json({ error: "Unable to load indexing health. Check the Search Console database setup." }); }
  });
  app.post("/api/admin/search-console/refresh", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await refreshInspections()); }
    catch (error) {
      if (error instanceof RefreshBlocked) {
        res.status(error.status).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Unable to refresh indexing health. Cached results remain available; check database setup and try later." });
      }
    }
  });
}
