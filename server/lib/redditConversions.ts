// Reddit Conversions API (CAPI) client — server-side conversion reporting
// paired with the Reddit Pixel (client/index.html + client/src/lib/reddit-pixel.ts).
//
// Docs: https://ads-api.reddit.com/docs/v3/api/post-conversion-events
//
// Requires REDDIT_PIXEL_ID (non-secret, the Reddit Ads Pixel id) and
// REDDIT_CONVERSIONS_API_TOKEN (secret, generated in Reddit Ads Events Manager).
// If either is missing, calls are silently skipped — CAPI is a redundant
// signal on top of the Pixel, never a hard requirement.
//
// Failures are logged and swallowed: ad tracking must never break the
// request it's attached to (e.g. registration).

const REDDIT_CAPI_BASE = "https://ads-api.reddit.com/api/v3/pixels";

export type RedditTrackingType =
  | "PAGE_VISIT"
  | "VIEW_CONTENT"
  | "SEARCH"
  | "ADD_TO_CART"
  | "ADD_TO_WISHLIST"
  | "PURCHASE"
  | "LEAD"
  | "SIGN_UP"
  | "CUSTOM";

export interface RedditConversionEventInput {
  trackingType: RedditTrackingType;
  /** Reddit's ad-click id (`rdt_cid`), if the visitor arrived via a Reddit ad. */
  clickId?: string | null;
  /** The Reddit Pixel's own first-party match id (`_rdt_uuid` cookie). */
  uuid?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  eventSourceUrl?: string | null;
  /** Shared with the paired client-side Pixel call to enable deduplication. */
  conversionId?: string | null;
}

/**
 * Sends a single conversion event to the Reddit Conversions API.
 * Fire-and-forget: never throws, never delays the caller meaningfully.
 */
export async function sendRedditConversionEvent(input: RedditConversionEventInput): Promise<void> {
  const pixelId = process.env.REDDIT_PIXEL_ID;
  const token = process.env.REDDIT_CONVERSIONS_API_TOKEN;
  if (!pixelId || !token) return;

  try {
    const event: Record<string, unknown> = {
      event_at: Date.now(),
      action_source: "WEBSITE",
      type: { tracking_type: input.trackingType },
    };
    if (input.clickId) event.click_id = input.clickId;
    if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
    if (input.conversionId) event.metadata = { conversion_id: input.conversionId };

    const user: Record<string, unknown> = {};
    if (input.ipAddress) user.ip_address = input.ipAddress;
    if (input.userAgent) user.user_agent = input.userAgent;
    if (input.uuid) user.uuid = input.uuid;
    if (Object.keys(user).length > 0) event.user = user;

    const res = await fetch(`${REDDIT_CAPI_BASE}/${encodeURIComponent(pixelId)}/conversion_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { events: [event] } }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[reddit-capi] ${input.trackingType} failed (${res.status}): ${text.slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`[reddit-capi] ${input.trackingType} error:`, err);
  }
}
