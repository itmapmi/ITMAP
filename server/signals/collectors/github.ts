/**
 * GitHub collector — public unauthenticated REST API (60 req/hr).
 * Generates a daily summary signal per vendor covering recent commit
 * activity, star count, and open issue count for their primary org.
 * Uses a date-scoped URL so each daily run creates a fresh row rather
 * than being deduped against a prior collection.
 */

export interface GitHubRawSignal {
  title: string;
  url: string;
  content: string;
  signalDate: Date;
  rawData: Record<string, unknown>;
}

interface GhRepo {
  name: string;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at: string;
  html_url: string;
  description: string | null;
}

interface GhCommit {
  commit: { author: { date: string } };
}

/**
 * Try to extract a GitHub org/user slug from a vendor's website URL.
 * Returns null if the URL isn't a github.com URL.
 * e.g. "https://github.com/hashicorp" → "hashicorp"
 */
function extractGithubOrgFromWebsite(website: string): string | null {
  try {
    const url = new URL(website.trim());
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
      if (parts.length > 0 && parts[0]) return parts[0];
    }
  } catch {
    // malformed URL — ignore
  }
  return null;
}

function deriveGithubOrg(vendorName: string): string {
  return vendorName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function githubFetch<T>(path: string): Promise<T | null> {
  try {
    const resp = await fetch(`https://api.github.com${path}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'spectio.ai/1.0',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    return resp.json() as Promise<T>;
  } catch {
    return null;
  }
}

/**
 * Collect GitHub signals for a vendor.
 * @param vendorName  Display name used for name-based org fallback
 * @param website     Optional vendor website URL — checked first for github.com org
 */
export async function collectGithubSignals(vendorName: string, website?: string): Promise<GitHubRawSignal[]> {
  // Prefer a GitHub org parsed directly from the vendor's website URL
  const orgFromWebsite = website ? extractGithubOrgFromWebsite(website) : null;
  const orgName = orgFromWebsite ?? deriveGithubOrg(vendorName);

  if (orgFromWebsite) {
    console.log(`[GitHub] Using org "${orgName}" from website URL for ${vendorName}`);
  }

  // Fetch up to 10 most-starred repos for the org
  const repos = await githubFetch<GhRepo[]>(
    `/orgs/${orgName}/repos?type=public&sort=stars&per_page=10`
  );

  if (!repos || repos.length === 0) {
    // Fallback: try as a user account (some vendors use user accounts not orgs)
    const userRepos = await githubFetch<GhRepo[]>(
      `/users/${orgName}/repos?type=public&sort=stars&per_page=10`
    );
    if (!userRepos || userRepos.length === 0) {
      console.log(`[GitHub] No org/user found for ${vendorName} (tried: ${orgName})`);
      return [];
    }
    return buildSignals(vendorName, orgName, userRepos);
  }

  return buildSignals(vendorName, orgName, repos);
}

async function buildSignals(
  vendorName: string,
  orgName: string,
  repos: GhRepo[]
): Promise<GitHubRawSignal[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Pick the most recently pushed repo as primary
  const sorted = [...repos].sort(
    (a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime()
  );
  const primaryRepo = sorted[0];
  if (!primaryRepo) return [];

  // Count commits in the last 30 days for the primary repo
  const commits = await githubFetch<GhCommit[]>(
    `/repos/${orgName}/${primaryRepo.name}/commits?per_page=100&since=${thirtyDaysAgo.toISOString()}`
  );
  const recentCommits = commits?.length ?? 0;

  // Aggregate stats across all repos
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);
  const totalOpenIssues = repos.reduce((s, r) => s + (r.open_issues_count ?? 0), 0);
  const activeRepos = repos.filter(r => new Date(r.pushed_at) > thirtyDaysAgo).length;

  const activityLevel =
    recentCommits > 100 ? 'very active' :
    recentCommits > 30  ? 'active' :
    recentCommits > 5   ? 'moderate' : 'low';

  const today = new Date().toISOString().split('T')[0];
  const title = `${vendorName} GitHub activity — ${recentCommits} commits in last 30 days`;
  const content = `${vendorName} has ${repos.length} public repos with ${totalStars.toLocaleString()} total stars and ${totalOpenIssues.toLocaleString()} open issues. Primary repo: ${primaryRepo.name} (${primaryRepo.description ?? 'no description'}). Development activity is ${activityLevel} (${recentCommits} commits, ${activeRepos}/${repos.length} repos active in last 30 days).`;

  // Use a date-scoped URL so each daily collection creates a distinct row
  // rather than being deduplicated against a prior run's stable org URL.
  const dailyUrl = `https://github.com/${orgName}?spectio_date=${today}`;

  return [
    {
      title,
      url: dailyUrl,
      content,
      signalDate: new Date(),
      rawData: {
        orgName,
        primaryRepo: primaryRepo.name,
        recentCommits,
        totalStars,
        totalOpenIssues,
        totalRepos: repos.length,
        activeRepos,
        activityLevel,
        collectionDate: today,
      },
    },
  ];
}
