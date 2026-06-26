// Backend enforcement for the RBAC feature-access system.
//
// Greying-out in the UI is cosmetic — the API must reject unauthorized access
// to locked features (including direct URL/page hits). This middleware is the
// single enforcement point and shares its feature-key list with the frontend
// via shared/features.ts so the two never drift.
import type { Request, Response, NextFunction } from "express";
import { hasFeatureAccess, type LockableFeatureKey } from "@shared/schema";

// Require authentication AND access to a specific lockable feature.
// Admins always pass. Buyers (non-vendor users) always pass.
// Vendor-scoped users must have the feature explicitly granted.
export function requireFeature(featureKey: LockableFeatureKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const isAuth = (req as any).isAuthenticated?.();
    if (!isAuth || !req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = req.user as any;
    const isVendorScoped = !!(user.vendorScopeId || user.vendorScopeIds?.length);
    if (hasFeatureAccess(user.role, user.featureAccess, featureKey, isVendorScoped)) {
      return next();
    }
    return res.status(403).json({
      error: "This feature is not enabled for your account.",
      code: "FEATURE_LOCKED",
      feature: featureKey,
    });
  };
}
