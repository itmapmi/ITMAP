import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES, LANGUAGE_STORAGE_KEY, type SupportedLanguageCode } from "@shared/languages";

// Every locale namespace JSON file is picked up automatically, so adding a
// new namespace only requires dropping a JSON file into locales/<lng>/ —
// no config changes needed here.
const modules = import.meta.glob("./locales/*/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, any>> = {};
for (const path in modules) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  resources[lng] = resources[lng] || {};
  resources[lng][ns] = modules[path]!.default;
}

export { SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES, LANGUAGE_STORAGE_KEY };
export type { SupportedLanguageCode };

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    ns: Object.keys(resources.en ?? {}),
    defaultNS: "common",
    interpolation: { escapeValue: false },
    // An empty string is a deliberate translation (e.g. "no unit suffix"),
    // not a missing key — only an absent key should fall back to English.
    returnEmptyString: true,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18n;
