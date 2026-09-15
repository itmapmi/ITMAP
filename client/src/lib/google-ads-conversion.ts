// Google Ads conversion tracking.
//
// The base gtag.js snippet lives in client/index.html (and the server-rendered
// legal pages) and only sets up the global site tag — it does not fire any
// conversion on its own. This app is a single-page app, so there is no
// standalone static "conversion page" to drop Google's page-view conversion
// snippet into; instead we fire the same `gtag('event', 'conversion', ...)`
// call from code the moment the equivalent SPA route is reached.
//
// Conversion action: "Page view" — landing on /register (see Register.tsx).

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const REGISTER_PAGE_VIEW_CONVERSION_ID = "AW-17890206301/l3iuCI_DkuobEN3E29JC";

/** Fire the Google Ads "Page view" conversion for landing on /register. */
export function trackGoogleAdsRegisterPageView(): void {
  try {
    window.gtag?.("event", "conversion", { send_to: REGISTER_PAGE_VIEW_CONVERSION_ID });
  } catch {
    // Best-effort only — tracking must never disrupt the app.
  }
}
