import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Sun, Moon } from "lucide-react";

type ForecastTheme = "dark" | "light";

interface ForecastThemeContextValue {
  theme: ForecastTheme;
  toggle: () => void;
  setTheme: (t: ForecastTheme) => void;
}

const ForecastThemeContext = createContext<ForecastThemeContextValue | null>(null);

const STORAGE_KEY = "forecast-builder-theme";

function readInitial(): ForecastTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
}

export function ForecastThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ForecastTheme>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  const setTheme = (t: ForecastTheme) => setThemeState(t);
  const toggle = () => setThemeState(prev => (prev === "dark" ? "light" : "dark"));

  return (
    <ForecastThemeContext.Provider value={{ theme, toggle, setTheme }}>
      <div data-fb-theme={theme} className="contents">
        {children}
      </div>
    </ForecastThemeContext.Provider>
  );
}

export function useForecastTheme(): ForecastThemeContextValue {
  const ctx = useContext(ForecastThemeContext);
  if (!ctx) {
    return {
      theme: "dark",
      toggle: () => {},
      setTheme: () => {},
    };
  }
  return ctx;
}

export function ForecastThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useForecastTheme();
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="button-forecast-theme-toggle"
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors " +
        (isLight
          ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          : "border-white/10 bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white") +
        " " + className
      }
    >
      {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      <span>{isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
