import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import i18n, { LANGUAGE_STORAGE_KEY } from "./i18n";
import { detectGeoLanguage } from "./i18n/geoLanguage";

// First-time visitors (no stored language choice yet) get a geography-based
// default — e.g. a visitor from Germany sees the German translation instead
// of always defaulting to English/browser language. Bounded by a short
// timeout in detectGeoLanguage so this never meaningfully delays first
// paint, and it never runs again once a preference (manual or geo-derived)
// is stored.
async function applyGeoLanguageIfNeeded(): Promise<void> {
  if (localStorage.getItem(LANGUAGE_STORAGE_KEY)) return;
  const geoLanguage = await detectGeoLanguage();
  if (geoLanguage) {
    await i18n.changeLanguage(geoLanguage);
  }
}

applyGeoLanguageIfNeeded().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
