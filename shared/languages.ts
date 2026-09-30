/**
 * shared/languages.ts
 *
 * Single source of truth for the site's supported UI languages, shared
 * between the client i18n config and the server's geo-based language
 * suggestion endpoint so the two lists can never drift apart.
 */
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const SUPPORTED_LANGUAGE_CODES: SupportedLanguageCode[] = SUPPORTED_LANGUAGES.map((l) => l.code);

export const LANGUAGE_STORAGE_KEY = "itmap_language";
// Unlike the old key (which also stored automatic guesses), this key is written
// only when the visitor explicitly chooses a language.
export const MANUAL_LANGUAGE_STORAGE_KEY = "itmap_manual_language";
