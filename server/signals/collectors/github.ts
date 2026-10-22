/**
 * GitHub collector — public unauthenticated REST API (60 req/hr).
 * Generates a daily summary signal per vendor covering recent commit
 * activity, star count, and open issue count for their primary org.
 * Uses a date-scoped URL so each daily run creates a fresh row rather
 * than being deduped against a prior collection.
 */
import { resolveGithubOrg } from './github-orgs';

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

// All automatic/manual pulls in this process share a conservative API budget.
let requestWindowStart = 0;
let requestsInWindow = 0;
let blockedUntil = 0;

async function githubFetch<T>(path: string): Promise<T | null> {
  try {
    const now = Date.now();
    if (now < blockedUntil) throw new Error(`API cooldown until ${new Date(blockedUntil).toISOString()}`);
    if (now - requestWindowStart >= 3600000) {
      requestWindowStart = now;
      requestsInWindow = 0;
    }
    if (requestsInWindow >= 55) throw new Error('Local hourly request budget exhausted');
    requestsInWindow++;
    const resp = await fetch(`https://api.github.com${path}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'itmap.ai/1.0',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    const reset = Number(resp.headers.get('x-ratelimit-reset')) * 1000;
    if (resp.headers.get('x-ratelimit-remaining') === '0' && reset > now) blockedUntil = reset;
    const retryAfter = Number(resp.headers.get('retry-after'));
    if ([403, 429].includes(resp.status) && retryAfter > 0) {
      blockedUntil = Math.max(blockedUntil, now + retryAfter * 1000);
    }
    if (resp.status === 404) return null;
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} at ${path.split('?')[0]} (remaining=${resp.headers.get('x-ratelimit-remaining') ?? 'unknown'}, reset=${resp.headers.get('x-ratelimit-reset') ?? 'unknown'})`);
    }
    return await resp.json() as T;
  } catch (err: any) {
    console.warn(`[GitHub] Request failed: ${err.message}`);
    throw err;
  }
}

/**
 * Collect GitHub signals for a vendor.
 * @param vendorName  Display name used for name-based org fallback
 * @param website     Optional vendor website URL — checked first for github.com org
 */
export async function collectGithubSignals(vendorName: string, website?: string): Promise<GitHubRawSignal[]> {
  // Prefer a GitHub org parsed directly from the vendor's website URL
  const orgName = resolveGithubOrg(vendorName, website);
  if (!orgName) {
    console.log(`[GitHub] No usable account name for ${vendorName}`);
    return [];
  }
  console.log(`[GitHub] Checking account "${orgName}" for ${vendorName}`);

  // "stars" is not a supported sort for this endpoint; inspect recent pushes.
  const repos = await githubFetch<GhRepo[]>(
    `/orgs/${orgName}/repos?type=public&sort=pushed&direction=desc&per_page=10`
  );

  if (!repos) {
    // Fallback: try as a user account (some vendors use user accounts not orgs)
    const userRepos = await githubFetch<GhRepo[]>(
      `/users/${orgName}/repos?type=owner&sort=pushed&direction=desc&per_page=10`
    );
    if (!userRepos || userRepos.length === 0) {
      console.log(`[GitHub] No org/user found for ${vendorName} (tried: ${orgName})`);
      return [];
    }
    return buildSignals(vendorName, orgName, userRepos);
  }

  if (repos.length === 0) {
    console.log(`[GitHub] Account "${orgName}" has no public repositories for ${vendorName}`);
    return [];
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
  // Do not manufacture a zero-activity snapshot from an unavailable endpoint.
  if (!commits) throw new Error(`GitHub commits unavailable for ${orgName}/${primaryRepo.name}`);
  const recentCommits = commits.length;

  // Aggregate stats across all repos
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);
  const totalOpenIssues = repos.reduce((s, r) => s + (r.open_issues_count ?? 0), 0);
  const activeRepos = repos.filter(r => new Date(r.pushed_at) > thirtyDaysAgo).length;

  const activityLevel =
    recentCommits > 100 ? 'very active' :
    recentCommits > 30  ? 'active' :
    recentCommits > 5   ? 'moderate' : 'low';

  const today = new Date().toISOString().split('T')[0];
  const title = `${vendorName} GitHub activity — ${recentCommits === 100 ? 'at least ' : ''}${recentCommits} commits in last 30 days`;
  const content = `Sample of ${repos.length} recently pushed public repos for ${vendorName}: ${totalStars.toLocaleString()} stars and ${totalOpenIssues.toLocaleString()} open issues across this sample. Primary repo: ${primaryRepo.name} (${primaryRepo.description ?? 'no description'}). Development activity is ${activityLevel} (${recentCommits === 100 ? 'at least ' : ''}${recentCommits} commits, ${activeRepos}/${repos.length} sampled repos active in last 30 days).`;

  // Use a date-scoped URL so each daily collection creates a distinct row
  // rather than being deduplicated against a prior run's stable org URL.
  const dailyUrl = `https://github.com/${orgName}?spectio_date=${today}`;
  console.log(`[GitHub] ${vendorName}: snapshot collected for ${orgName} (${repos.length} sampled repos)`);

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
