import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Building2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { COMPANY_PROFILE_PATH } from "@shared/company-email";

// One-time nudge for consumer-domain sign-ups (Gmail, Outlook, …). The
// company-email gate (shared/company-email.ts) otherwise only reveals
// itself when the buyer clicks a locked Reports / News / Intelligence Feed
// item, so someone who never clicks a locked tab may not realise a free
// unlock exists. Shown in the header stack on every page until dismissed,
// verified, or the user is already on the profile page.
//
// Dismissal is remembered per account in localStorage (a small list of user
// ids, so switching between accounts in one browser doesn't re-show a prompt
// that was already closed). Whether the prompt applies at all is decided
// solely by useAuth().needsCompanyProfile, which already excludes admins,
// vendor accounts, business-domain sign-ups and verified company emails.
export const COMPANY_PROFILE_PROMPT_DISMISSED_KEY = "itmap_company_profile_prompt_dismissed";
const MAX_REMEMBERED_ACCOUNTS = 20;

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(COMPANY_PROFILE_PROMPT_DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function isCompanyProfilePromptDismissed(userId: string): boolean {
  return readDismissed().includes(userId);
}

export function dismissCompanyProfilePrompt(userId: string) {
  try {
    const next = [...readDismissed().filter((id) => id !== userId), userId].slice(-MAX_REMEMBERED_ACCOUNTS);
    localStorage.setItem(COMPANY_PROFILE_PROMPT_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private browsing, quota) — the prompt will
    // simply come back on the next page load; nothing breaks.
  }
}

export function CompanyProfilePromptBanner() {
  const { user, needsCompanyProfile } = useAuth();
  const [location] = useLocation();
  const userId = user?.id ?? null;

  // Re-read the stored dismissal whenever the signed-in account changes so a
  // logout/login to a different account gets its own decision.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(userId ? isCompanyProfilePromptDismissed(userId) : false);
  }, [userId]);

  const onProfilePage = location === COMPANY_PROFILE_PATH || location.startsWith(`${COMPANY_PROFILE_PATH}?`);

  if (!userId || !needsCompanyProfile || dismissed || onProfilePage) return null;

  const handleDismiss = () => {
    dismissCompanyProfilePrompt(userId);
    setDismissed(true);
  };

  return (
    // Solid background: this sits in the translucent fixed header stack,
    // which otherwise lets a light page top wash the text out.
    <div
      className="bg-[#0b2f3a] border-b border-cyan-400/30 text-cyan-50 text-sm"
      role="status"
      data-testid="banner-company-profile-prompt"
    >
      <div className="max-w-7xl mx-auto pl-4 pr-2 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2">
        <Building2 className="h-4 w-4 shrink-0 text-cyan-300" />
        <span className="flex-1 min-w-0 basis-[calc(100%-2rem)] sm:basis-auto text-left sm:text-center">
          You signed up with a personal email — complete your short company profile to unlock Reports, News and
          the Intelligence Feed. It's free.
        </span>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <Link
            href={COMPANY_PROFILE_PATH}
            className="inline-flex items-center h-7 px-3 rounded-md border border-cyan-400/40 text-cyan-50 font-medium hover:bg-cyan-400/10 transition-colors whitespace-nowrap"
            data-testid="link-complete-company-profile"
          >
            Complete profile
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-cyan-200/70 hover:text-white hover:bg-white/10 transition-colors"
            data-testid="button-dismiss-company-profile-prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
