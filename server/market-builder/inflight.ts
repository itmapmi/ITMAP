/**
 * In-process registry of vendors currently being processed by a Market
 * Builder stage. Powers the "Now processing" panel on the job dashboard.
 *
 * Stages 6 and 9 process up to MARKET_BUILDER_VENDOR_CONCURRENCY vendors in
 * parallel; this module lets the UI see the current set of in-flight vendor
 * names, not just the interleaved batch log lines.
 *
 * Lives in-memory only — on restart the set is empty until workers re-add
 * themselves. That is acceptable: the activity log (persisted to DB) remains
 * the source of truth for "what happened", and this set is purely a
 * point-in-time view of "what is happening right now".
 */

const registry = new Map<string, Set<string>>();

function key(jobId: string, stageNum: number): string {
  return `${jobId}:${stageNum}`;
}

export function addInFlightVendor(jobId: string, stageNum: number, vendorName: string): void {
  const k = key(jobId, stageNum);
  let set = registry.get(k);
  if (!set) {
    set = new Set();
    registry.set(k, set);
  }
  set.add(vendorName);
}

export function removeInFlightVendor(jobId: string, stageNum: number, vendorName: string): void {
  const set = registry.get(key(jobId, stageNum));
  if (!set) return;
  set.delete(vendorName);
  if (set.size === 0) registry.delete(key(jobId, stageNum));
}

export function clearInFlightVendors(jobId: string, stageNum: number): void {
  registry.delete(key(jobId, stageNum));
}

export function listInFlightVendors(jobId: string, stageNum: number): string[] {
  const set = registry.get(key(jobId, stageNum));
  return set ? Array.from(set) : [];
}
