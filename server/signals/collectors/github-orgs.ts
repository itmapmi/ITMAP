// Explicit brand-to-official-account aliases; never fuzzy-match organizations.
// Direct github.com vendor website URLs take precedence over these aliases.
const OFFICIAL_ORGS: Record<string, string> = {
  "microsoft": "microsoft",
  "microsoft azure": "Azure",
  "google cloud": "GoogleCloudPlatform",
  "amazon web services": "aws",
  "aws": "aws",
  "pure storage": "PureStorage",
  "palo alto networks": "PaloAltoNetworks",
  "dell technologies": "dell",
  "ovh cloud": "ovh",
  "ovhcloud": "ovh",
};

export function resolveGithubOrg(vendorName: string, website?: string): string {
  try {
    const url = new URL(website?.trim() ?? "");
    if (["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      const org = url.pathname.split("/").filter(Boolean)[0];
      if (org && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(org)) return org;
    }
  } catch { /* Non-GitHub vendor sites use an exact alias or legacy fallback. */ }
  return OFFICIAL_ORGS[vendorName.trim().toLowerCase()]
    ?? vendorName.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}
