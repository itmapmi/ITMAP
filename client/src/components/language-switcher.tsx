import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "@/i18n";

interface LanguageSwitcherProps {
  /** Dark trigger for the main site chrome (default); light for admin-style surfaces. */
  variant?: "dark" | "light";
  className?: string;
}

/**
 * Language switcher shown in the site navigation. Manual selection is
 * persisted to localStorage by i18next-browser-languagedetector (see
 * client/src/i18n/index.ts `detection.caches`), so it's remembered across
 * sessions once the user picks one; before that, the browser language wins.
 */
export function LanguageSwitcher({ variant = "dark", className = "" }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ??
    SUPPORTED_LANGUAGES.find((l) => i18n.language?.startsWith(l.code)) ??
    SUPPORTED_LANGUAGES[0];

  const isDark = variant === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors border ${
            isDark
              ? "text-slate-400 hover:text-white hover:bg-white/5 border-white/10"
              : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 border-gray-200"
          } ${className}`}
          data-testid="button-language-switcher"
          title="Change language"
        >
          <Globe className="h-3.5 w-3.5" />
          {current.code.toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={isDark ? "bg-slate-900 border-white/10 min-w-[180px]" : "min-w-[180px]"}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code as SupportedLanguageCode)}
            className={
              isDark
                ? "flex items-center justify-between text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                : "flex items-center justify-between cursor-pointer"
            }
            data-testid={`option-language-${lang.code}`}
          >
            <span>{lang.label}</span>
            {lang.code === current.code && <Check className="h-3.5 w-3.5 text-cyan-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
