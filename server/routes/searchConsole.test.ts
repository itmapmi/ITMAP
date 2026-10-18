import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../storage", () => ({ storage: {} }));
const h = vi.hoisted(() => ({ inventory: vi.fn(), refresh: vi.fn() }));
vi.mock("../searchConsole/store", () => ({
  indexingInventory: h.inventory,
  RefreshBlocked: class extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock("../searchConsole/refresh", () => ({ refreshInspections: h.refresh }));
import { registerSearchConsoleRoutes } from "./searchConsole";
import { RefreshBlocked } from "../searchConsole/store";

let role: string | null;
const app = express();
app.use((req: any, _res, next) => {
  req.isAuthenticated = () => role !== null;
  req.user = role ? { role } : undefined;
  next();
});
registerSearchConsoleRoutes(app);
beforeEach(() => { vi.resetAllMocks(); role = null; });
describe("Search Console admin authorization", () => {
  it.each([null, "user", "vendor"])("denies %s before inventory or Google calls", async userRole => {
    role = userRole;
    expect((await request(app).get("/api/admin/search-console")).status).toBe(403);
    expect((await request(app).post("/api/admin/search-console/refresh")).status).toBe(403);
    expect(h.inventory).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it("lets admins load cached inventory without inspection calls", async () => {
    role = "admin"; h.inventory.mockResolvedValue({ rows: [] });
    const result = await request(app).get("/api/admin/search-console");
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it("does not leak raw provider or database failures", async () => {
    role = "admin"; h.refresh.mockRejectedValue(new Error("Authorization: SECRET"));
    const result = await request(app).post("/api/admin/search-console/refresh");
    expect(result.status).toBe(500);
    expect(result.text).not.toContain("SECRET");
  });
  it("returns actionable cooldown and configuration failures", async () => {
    role = "admin"; h.refresh.mockRejectedValue(new RefreshBlocked(429, "Refresh cooldown is active."));
    const result = await request(app).post("/api/admin/search-console/refresh");
    expect(result.status).toBe(429);
    expect(result.body.error).toContain("cooldown");
  });
});
