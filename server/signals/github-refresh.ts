export interface GithubRefreshCandidate {
  id: string;
  lastCollected: Date | null;
  lastAttempted: Date | null;
}

/** Failed/empty attempts must advance the queue, just like successful pulls. */
export function chooseGithubRefresh(
  candidates: GithubRefreshCandidate[],
  staleDays: number,
  limit: number,
  now = Date.now(),
): string[] {
  const day = 86400000;
  const touched = (v: GithubRefreshCandidate) =>
    Math.max(v.lastAttempted?.getTime() ?? 0, v.lastCollected?.getTime() ?? 0);
  return candidates
    .filter(v => (!v.lastCollected || v.lastCollected.getTime() < now - staleDays * day)
      && (!v.lastAttempted || v.lastAttempted.getTime() < now - day))
    .sort((a, b) => touched(a) - touched(b) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
    .map(v => v.id);
}
