import { parseCampaigns } from "./lead";

// Login can be configured before Lead Sync is approved or a form is mapped.
// This is a server-owned whitelist, never a visitor-provided signup entitlement.
export function campaignLoginAllowed(slug: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return false;
  const configured = (process.env.LINKEDIN_CAMPAIGN_LOGIN_SLUGS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length > 50 || configured.some((s) => !/^[a-z0-9][a-z0-9-]{0,79}$/.test(s))) {
    throw new Error("Invalid campaign login whitelist");
  }
  return configured.includes(slug) ||
    parseCampaigns(process.env.LINKEDIN_CAMPAIGNS_JSON).some((c) => c.slug === slug);
}
