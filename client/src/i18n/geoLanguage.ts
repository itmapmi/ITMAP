/**
 * client/src/i18n/geoLanguage.ts
 *
 * Suggests a default UI language for brand-new visitors (no stored
 * preference yet) based on the server's coarse IP geolocation. Bounded by a
 * short timeout so a slow/failed network call never blocks the app from
 * rendering for long — it just falls back to the existing browser-language
 * default.
 */
import type { SupportedLanguageCode } from "@shared/languages";
import { SUPPORTED_LANGUAGE_CODES } from "@shared/languages";

const FETCH_TIMEOUT_MS = 1200;

export async function detectGeoLanguage(): Promise<SupportedLanguageCode | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/geo-language", { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const language = data?.language;
    return typeof language === "string" && (SUPPORTED_LANGUAGE_CODES as string[]).includes(language)
      ? (language as SupportedLanguageCode)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
