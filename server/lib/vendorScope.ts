// Shared vendor-seat scoping helpers. A signed-in vendor seat is pinned to
// one or more vendors (req.user.vendorScopeIds, falling back to the legacy
// singular vendorScopeId) and, through those vendors, to the market(s) they
// belong to. Every vendor-facing self-service surface (Lead Generator,
// Market Trends, ...) derives its access boundary from this file so the
// scoping logic can never drift between modules.
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

// Returns ALL vendor IDs assigned to this seat. Prefers the explicit
// vendorScopeIds array (set by the multi-market picker); falls back to the
// legacy single vendorScopeId for older seat records.
export function vendorScopeIds(req: Request): string[] {
  const user = req.user as any;
  const ids = user?.vendorScopeIds as string[] | null | undefined;
  if (ids?.length) return ids;
  const single = user?.vendorScopeId as string | null | undefined;
  return single ? [single] : [];
}

// Returns the primary vendor ID (first in the list, or null if no seat).
export function vendorScopeId(req: Request): string | null {
  return vendorScopeIds(req)[0] ?? null;
}

// Resolves the distinct markets this seat's assigned vendors belong to. A
// seat can be assigned vendors across multiple markets; vendors that share a
// market collapse into a single entry. Used by vendor-facing self-service
// surfaces, which show data scoped to the ENTIRE visitor pool for those
// markets — not just events attributed to the assigned vendor(s).
export async function vendorScopeDetails(req: Request): Promise<{
  vendors: { id: string; name: string; marketId: string | null }[];
  markets: { id: string; name: string }[];
}> {
  const ids = vendorScopeIds(req);
  const vendorBriefs = await Promise.all(ids.map((id) => storage.getVendorBrief(id)));
  const vendors = vendorBriefs
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({ id: v.id, name: v.name, marketId: v.marketId ?? null }));
  const marketIds = Array.from(
    new Set(vendors.filter((v) => !!v.marketId).map((v) => v.marketId as string)),
  );
  const marketRecords = await Promise.all(marketIds.map((id) => storage.getMarketById(id)));
  const markets = marketRecords
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ id: m.id, name: m.name }));
  return { vendors, markets };
}

// Gate for vendor-facing self-service surfaces: only authenticated users
// that have a vendor seat assigned. Admins are not vendor-scoped, so they
// use the admin panel rather than these self-service variants.
export function requireVendorScope(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (vendorScopeIds(req).length === 0) {
    return res.status(403).json({ error: "No vendor seat assigned to this account" });
  }
  next();
}
