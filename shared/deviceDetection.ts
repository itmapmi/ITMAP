/**
 * shared/deviceDetection.ts
 *
 * Single source of truth for classifying a user agent as "phone" or
 * "desktop". Used both by the mobile-redirect middleware (which decides
 * whether to send a visitor to the /mobile/* experience) and by admin
 * traffic intelligence (which reports, per visitor, whether they arrived
 * from a phone or a desktop). Keeping one regex means the two surfaces can
 * never silently disagree about what counts as "mobile".
 *
 * Deliberately excludes tablets (iPad, Android "Tablet" builds) — the
 * mobile experience targets phone-sized screens, and tablets get plenty of
 * room for the desktop layout, so they are classified as "desktop" here too.
 */
export const MOBILE_UA_REGEX =
  /iPhone|iPod|Android(?!.*Tablet)|Windows Phone|BlackBerry|IEMobile|Opera Mini/i;

export type DeviceType = "phone" | "desktop";

/** Classifies a raw User-Agent string as "phone" or "desktop". */
export function getDeviceType(userAgent: string | null | undefined): DeviceType {
  return userAgent && MOBILE_UA_REGEX.test(userAgent) ? "phone" : "desktop";
}
