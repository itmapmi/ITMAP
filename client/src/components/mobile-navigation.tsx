import { Link } from "wouter";
import { Monitor } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";
import { useViewMode } from "@/hooks/use-view-mode";

/**
 * Minimal header for the /mobile/* experience. Deliberately not a port of
 * the desktop Navigation (no dropdowns, no wide nav item list) — each mobile
 * page owns its own in-page navigation (tabs, back links). This bar only
 * carries the brand mark and the escape hatch back to the desktop layout.
 */
export default function MobileNavigation() {
  const { switchToDesktop } = useViewMode();

  return (
    <header className="sticky top-0 z-50 bg-[#1e2130]/95 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center justify-between px-4 h-14">
        <Link href="/">
          <SpectioLogo />
        </Link>
        <button
          onClick={switchToDesktop}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          data-testid="button-switch-desktop"
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop site
        </button>
      </div>
    </header>
  );
}
