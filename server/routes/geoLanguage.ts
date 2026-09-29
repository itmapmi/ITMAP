/**
 * server/routes/geoLanguage.ts
 *
 * Suggests a default UI language for first-time visitors based on coarse
 * IP geolocation (server/geoResolver.ts). Only covers the handful of
 * countries that map unambiguously onto one of the site's six languages —
 * everything else returns `language: null` and the client falls back to
 * its existing browser-language / English default.
 *
 * This never overrides a language the visitor already picked — the client
 * only calls this endpoint when no stored preference exists yet.
 */
import type { Express, Request, Response } from "express";
import { resolveGeo } from "../geoResolver";
import { SUPPORTED_LANGUAGE_CODES, type SupportedLanguageCode } from "../../shared/languages";

// Country → language. Deliberately narrow: only countries where one of our
// six languages is the clear native default. Spanish-speaking Latin America
// has no matching language on the site, so it is intentionally omitted and
// falls through to `null` (client defaults to English).
const COUNTRY_TO_LANGUAGE: Record<string, SupportedLanguageCode> = {
  DE: "de",
  AT: "de", // Austria — German
  CH: "de", // Switzerland — plurilingual, German is the largest share
  FR: "fr",
  BR: "pt-BR",
  JP: "ja",
  KR: "ko",
};

export function registerGeoLanguageRoutes(app: Express): void {
  app.get("/api/geo-language", async (req: Request, res: Response) => {
    try {
      const ip = (req.ip ?? req.socket?.remoteAddress ?? "").trim();
      const geo = await resolveGeo(ip);
      const code = geo.countryCode ? COUNTRY_TO_LANGUAGE[geo.countryCode.toUpperCase()] : undefined;
      const language = code && SUPPORTED_LANGUAGE_CODES.includes(code) ? code : null;
      res.json({ language, countryCode: geo.countryCode ?? null });
    } catch {
      // Never let a geo lookup failure surface as an error — the client
      // treats a non-language response the same as "no suggestion".
      res.json({ language: null, countryCode: null });
    }
  });
}
