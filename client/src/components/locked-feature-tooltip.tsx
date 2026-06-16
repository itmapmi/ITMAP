import { Lock, Mail } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  SALES_CONTACT_EMAIL,
  featureLabel,
  type LockableFeatureKey,
} from "@shared/features";

export const LOCKED_FEATURE_MESSAGE = `Contact ${SALES_CONTACT_EMAIL} for access`;

interface LockedFeatureTooltipProps {
  children: React.ReactNode;
  message?: string;
}

/**
 * Wraps a (visually disabled) trigger and shows the standard
 * "Contact sales@dcig.com for access" tooltip on hover/focus.
 * Use for locked features that are shown greyed-out rather than hidden.
 */
export function LockedFeatureTooltip({
  children,
  message = LOCKED_FEATURE_MESSAGE,
}: LockedFeatureTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          <span>{message}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface LockedFeaturePanelProps {
  featureKey: LockableFeatureKey;
  variant?: "light" | "dark";
}

/**
 * Full-page "premium feature" upsell shown when a user opens a locked feature
 * page directly (e.g. typing a URL or following an old link). Renders a clean
 * "Contact sales@dcig.com for access" panel instead of degrading into API
 * errors or empty states.
 */
export function LockedFeaturePanel({
  featureKey,
  variant = "dark",
}: LockedFeaturePanelProps) {
  const label = featureLabel(featureKey);
  const isDark = variant === "dark";

  return (
    <div
      data-testid="locked-feature-panel"
      className={
        isDark
          ? "min-h-screen bg-slate-950 text-white flex items-center justify-center px-6 pt-20 pb-24"
          : "min-h-[70vh] flex items-center justify-center px-6 py-16"
      }
    >
      <div
        className={
          isDark
            ? "max-w-md w-full text-center bg-slate-900 border border-white/10 rounded-2xl p-10"
            : "max-w-md w-full text-center bg-white border border-gray-200 rounded-2xl p-10 shadow-sm"
        }
      >
        <div
          className={
            isDark
              ? "mx-auto mb-6 h-14 w-14 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center"
              : "mx-auto mb-6 h-14 w-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center"
          }
        >
          <Lock className={isDark ? "h-6 w-6 text-cyan-400" : "h-6 w-6 text-blue-600"} />
        </div>
        <h1
          className={
            isDark
              ? "text-2xl font-bold mb-2"
              : "text-2xl font-bold text-gray-900 mb-2"
          }
        >
          {label} is a premium feature
        </h1>
        <p className={isDark ? "text-slate-400 mb-6" : "text-gray-500 mb-6"}>
          {label} isn't included in your current plan. Get in touch with our team
          to unlock it for your account.
        </p>
        <a
          href={`mailto:${SALES_CONTACT_EMAIL}`}
          data-testid="link-contact-sales"
          className={
            isDark
              ? "inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-5 py-2.5 rounded-lg font-medium transition-all"
              : "inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
          }
        >
          <Mail className="h-4 w-4" />
          Contact {SALES_CONTACT_EMAIL}
        </a>
      </div>
    </div>
  );
}

export { Lock as LockIcon };
