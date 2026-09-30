import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import i18n, { MANUAL_LANGUAGE_STORAGE_KEY } from "./i18n";
import { detectGeoLanguage } from "./i18n/geoLanguage";

// Recheck the current IP on each visit (and when returning to the tab after
// changing networks). Only an explicit choice in the language switcher sticks.
async function applyGeoLanguageIfNeeded(): Promise<void> {
  if (localStorage.getItem(MANUAL_LANGUAGE_STORAGE_KEY)) return;
  const geoLanguage = await detectGeoLanguage();
  if (localStorage.getItem(MANUAL_LANGUAGE_STORAGE_KEY)) return;
  // A location without a supported language falls back to the browser,
  // including when the visitor disconnects from a previously matched VPN.
  const browserLanguage = navigator.languages?.[0] || navigator.language || "en";
  await i18n.changeLanguage(geoLanguage || browserLanguage);
}

applyGeoLanguageIfNeeded().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
  window.addEventListener("focus", () => { void applyGeoLanguageIfNeeded(); });
});
