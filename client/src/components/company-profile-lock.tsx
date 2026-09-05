import { Lock, ArrowRight, Building2 } from "lucide-react";
import { Link } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  COMPANY_EMAIL_REQUIRED,
  COMPANY_PROFILE_LOCK_MESSAGE,
  COMPANY_PROFILE_PATH,
} from "@shared/company-email";
import { cn } from "@/lib/utils";

/**
 * Lock surfaces for the company-email profile gate
 * (shared/company-email.ts). Buyers who signed up with a consumer-domain
 * address see Reports / News / Intelligence Feed locked until they complete
 * their profile and verify a company email. Every surface says the same
 * thing and sends people to the same place: the Profile page.
 */

export const COMPANY_PROFILE_CTA_LABEL = "Complete profile";

/** True when a failed request was refused by the company-email gate. */
export function isCompanyEmailRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(COMPANY_EMAIL_REQUIRED);
}

interface CompanyProfileLockTooltipProps {
  children: React.ReactNode;
}

/**
 * Hover/focus tooltip for a greyed-out trigger. The trigger itself should
 * navigate to the Profile page on click (tooltips can't be hovered into).
 */
export function CompanyProfileLockTooltip({ children }: CompanyProfileLockTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-[240px]" data-testid="tooltip-company-profile-lock">
          <div className="flex items-start gap-1.5">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            <div>
              <p>{COMPANY_PROFILE_LOCK_MESSAGE}.</p>
              <p className="mt-1 flex items-center gap-1 font-medium">
                {COMPANY_PROFILE_CTA_LABEL} <ArrowRight className="h-3 w-3" />
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface CompanyProfileLockedPanelProps {
  /** What is locked, e.g. "Research reports". */
  feature: string;
  variant?: "light" | "mobile";
  className?: string;
}

/**
 * In-panel replacement for locked content — shown when a section is opened
 * directly (URL, deep link) or the API answers 403 company_email_required.
 */
export function CompanyProfileLockedPanel({ feature, variant = "light", className }: CompanyProfileLockedPanelProps) {
  if (variant === "mobile") {
    return (
      <div
        className={cn("border border-dashed border-slate-300 bg-slate-50 px-4 py-9 text-center font-[Montserrat]", className)}
        data-testid="panel-company-profile-lock"
      >
        <Lock className="mx-auto mb-2 h-[22px] w-[22px] text-sky-500" />
        <strong className="block text-[13px] text-slate-950">{feature} is locked</strong>
        <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
          {COMPANY_PROFILE_LOCK_MESSAGE}. Add your company name, work email and role, then confirm the email we send you.
        </p>
        <Link href={COMPANY_PROFILE_PATH}>
          <span
            className="mt-4 inline-flex h-10 items-center gap-2 bg-slate-950 px-4 text-xs font-bold text-white"
            data-testid="link-complete-profile"
          >
            <Building2 className="h-3.5 w-3.5" /> {COMPANY_PROFILE_CTA_LABEL}
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center justify-center px-6 py-14", className)}
      data-testid="panel-company-profile-lock"
    >
      <div className="max-w-md w-full text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
        <div className="mx-auto mb-5 h-12 w-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
          <Lock className="h-5 w-5 text-blue-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{feature} is locked</h3>
        <p className="text-gray-500 mb-6 text-sm">
          {COMPANY_PROFILE_LOCK_MESSAGE}. Add your company name, work email and role, then confirm the email we send you.
        </p>
        <Link href={COMPANY_PROFILE_PATH}>
          <span
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer"
            data-testid="link-complete-profile"
          >
            <Building2 className="h-4 w-4" /> {COMPANY_PROFILE_CTA_LABEL}
          </span>
        </Link>
      </div>
    </div>
  );
}
