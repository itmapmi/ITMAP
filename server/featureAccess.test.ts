import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireFeature } from "./featureAccess";

// Build a minimal mock Express req/res and a next() spy so we can assert
// exactly how requireFeature responds in each authz scenario.
function makeCtx(opts: {
  isAuthenticated?: boolean;
  user?: Record<string, unknown> | null;
}) {
  const statusFn = vi.fn().mockReturnThis();
  const jsonFn = vi.fn().mockReturnThis();
  const req = {
    isAuthenticated: () => opts.isAuthenticated ?? false,
    user: opts.user ?? undefined,
  } as unknown as Request;
  const res = { status: statusFn, json: jsonFn } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, statusFn, jsonFn };
}

describe("requireFeature middleware", () => {
  it("returns 401 when the request is unauthenticated", () => {
    const { req, res, next, statusFn, jsonFn } = makeCtx({
      isAuthenticated: false,
    });
    requireFeature("market_builder")(req, res, next);
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when authenticated but req.user is missing", () => {
    const { req, res, next, statusFn } = makeCtx({
      isAuthenticated: true,
      user: null,
    });
    requireFeature("forecast_builder")(req, res, next);
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 FEATURE_LOCKED when the user lacks the grant", () => {
    const { req, res, next, statusFn, jsonFn } = makeCtx({
      isAuthenticated: true,
      user: { role: "user", featureAccess: ["news"] },
    });
    requireFeature("datasheets")(req, res, next);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith({
      error: "This feature is not enabled for your account.",
      code: "FEATURE_LOCKED",
      feature: "datasheets",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the user has been granted the feature", () => {
    const { req, res, next, statusFn } = makeCtx({
      isAuthenticated: true,
      user: { role: "user", featureAccess: ["datasheets", "news"] },
    });
    requireFeature("datasheets")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
  });

  it("calls next() for admins regardless of granted features", () => {
    const { req, res, next, statusFn } = makeCtx({
      isAuthenticated: true,
      user: { role: "admin", featureAccess: [] },
    });
    requireFeature("rfp")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
  });

  it("treats a null/undefined featureAccess list as no grants", () => {
    const { req, res, next, statusFn } = makeCtx({
      isAuthenticated: true,
      user: { role: "user", featureAccess: undefined },
    });
    requireFeature("news")(req, res, next);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  describe("company-email profile gate", () => {
    const consumerBuyer = { role: "user", email: "buyer@gmail.com", companyEmailVerified: false };

    it("returns 403 company_email_required for a consumer-domain buyer on a gated feature", () => {
      for (const feature of ["research_reports", "news", "intelligence_feed"] as const) {
        const { req, res, next, statusFn, jsonFn } = makeCtx({ isAuthenticated: true, user: consumerBuyer });
        requireFeature(feature)(req, res, next);
        expect(statusFn).toHaveBeenCalledWith(403);
        expect(jsonFn).toHaveBeenCalledWith({
          error: "company_email_required",
          code: "COMPANY_EMAIL_REQUIRED",
          feature,
        });
        expect(next).not.toHaveBeenCalled();
      }
    });

    it("does not gate non-gated features for the same buyer", () => {
      const { req, res, next, statusFn } = makeCtx({ isAuthenticated: true, user: consumerBuyer });
      requireFeature("market_builder")(req, res, next);
      expect(statusFn).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("passes once the company email is verified", () => {
      const { req, res, next, statusFn } = makeCtx({
        isAuthenticated: true,
        user: { ...consumerBuyer, companyEmailVerified: true },
      });
      requireFeature("research_reports")(req, res, next);
      expect(statusFn).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("never gates business-domain buyers, admins, or vendor seats", () => {
      const cases = [
        { role: "user", email: "cio@acme.com", companyEmailVerified: false },
        { role: "admin", email: "ops@gmail.com", companyEmailVerified: false },
        { role: "user", email: "rep@outlook.com", companyEmailVerified: false, persona: "vendor", featureAccess: ["news"] },
        { role: "user", email: "rep@yahoo.com", companyEmailVerified: false, vendorScopeId: "v1", featureAccess: ["news"] },
      ];
      for (const user of cases) {
        const { req, res, next, statusFn } = makeCtx({ isAuthenticated: true, user });
        requireFeature("news")(req, res, next);
        expect(statusFn, JSON.stringify(user)).not.toHaveBeenCalled();
        expect(next, JSON.stringify(user)).toHaveBeenCalled();
      }
    });
  });
});
