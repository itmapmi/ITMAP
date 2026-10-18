import { getPublicSitemapEntries } from "../publicSitemap";
import { inspectionClient } from "./config";
import { inspectionError, normalizeInspection } from "./status";
import { eligibleForInspection, finishRefresh, indexingInventory, RefreshBlocked, reserveRefresh, saveInspection } from "./store";

export async function refreshInspections() {
  const inventory = await indexingInventory();
  if (!inventory.connection.configured) throw new RefreshBlocked(409, inventory.connection.message);
  const candidates = inventory.rows.filter(row => eligibleForInspection(row))
    .sort((a, b) => (a.lastInspectionTime ?? "").localeCompare(b.lastInspectionTime ?? ""))
    .slice(0, inventory.quota.batchSize);
  if (!candidates.length) return { attempted: 0, message: "All public URLs have recent inspections. Successful results are cached for 24 hours; errors retry after one hour." };
  let client;
  try { client = inspectionClient(); }
  catch { throw new RefreshBlocked(409, "Search Console credentials are invalid. Follow the service-account setup guide; do not use Google sign-in credentials."); }
  const { token, count } = await reserveRefresh(candidates.length);
  let attempted = 0;
  let failed = 0;
  let pause = false;
  try {
    for (const row of candidates.slice(0, count)) {
      // Visibility can change after the batch starts. Never inspect removed URLs.
      const currentUrls = new Set((await getPublicSitemapEntries()).map(entry => entry.url));
      if (!currentUrls.has(row.url)) continue;
      let result = null;
      let error = null;
      let stop = false;
      attempted++;
      try {
        const response = await client.request({
          url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
          method: "POST",
          data: { inspectionUrl: row.url, siteUrl: inventory.connection.property, languageCode: "en-US" },
          timeout: 15000,
          retry: false,
        });
        result = normalizeInspection(response.data, row.url);
      } catch (cause: any) {
        const status = Number(cause?.response?.status) || undefined;
        error = inspectionError(status);
        failed++;
        // Property/auth/quota failures affect the whole batch; do not burn calls.
        stop = status === 401 || status === 403 || status === 429;
        pause = status === 403 || status === 429;
      }
      // DB failures must propagate, not masquerade as Google inspection errors.
      await saveInspection(inventory.connection.property, row.url, result, error);
      if (stop) break;
    }
    return {
      attempted,
      message: `Inspected ${attempted} public URL${attempted === 1 ? "" : "s"}. ${failed} inspection error${failed === 1 ? "" : "s"}.${pause ? " Refreshes paused for 24 hours; check Google permissions and quota." : ""}`,
    };
  } finally { await finishRefresh(token, pause); }
}
