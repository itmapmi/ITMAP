import { parseCampaigns } from "./lead";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { markets } from "@shared/schema";

// Campaign slugs are not market URLs: map them to actual database IDs.
const destinationsSchema = z.record(
  z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  z.string().uuid(),
).refine((mapping) => Object.keys(mapping).length <= 50);

export function campaignMarketMappings() {
  const raw = process.env.LINKEDIN_CAMPAIGN_MARKETS_JSON;
  return destinationsSchema.parse(raw?.trim() ? JSON.parse(raw) : {});
}

export async function campaignDestination(slug: string): Promise<string> {
  const marketId = campaignMarketMappings()[slug];
  if (!marketId) return "/markets";
  const [market] = await db.select({
    id: markets.id, isVisible: markets.isVisible, visibility: markets.visibility,
  }).from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!market || !market.isVisible || market.visibility !== "public") {
    throw new Error("Campaign market is unavailable");
  }
  return `/markets/${market.id}`;
}

// Login can be configured before Lead Sync is approved or a form is mapped.
// This is a server-owned whitelist, never a visitor-provided signup entitlement.
export function campaignLoginAllowed(slug: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return false;
  const configured = (process.env.LINKEDIN_CAMPAIGN_LOGIN_SLUGS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length > 50 || configured.some((s) => !/^[a-z0-9][a-z0-9-]{0,79}$/.test(s))) {
    throw new Error("Invalid campaign login whitelist");
  }
  return Object.hasOwn(campaignMarketMappings(), slug) || configured.includes(slug) ||
    parseCampaigns(process.env.LINKEDIN_CAMPAIGNS_JSON).some((c) => c.slug === slug);
}
