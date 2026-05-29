import { Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SALES_CONTACT_EMAIL } from "@shared/features";

export const LOCKED_FEATURE_MESSAGE = `Contact ${SALES_CONTACT_EMAIL} for access`;

interface LockedFeatureTooltipProps {
  children: React.ReactNode;
  message?: string;
}

/**
 * Wraps a (visually disabled) trigger and shows the standard
 * "Contact sales@spectio.ai for access" tooltip on hover/focus.
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

export { Lock as LockIcon };
