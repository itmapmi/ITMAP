import { ArrowLeft, MoreVertical } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  className?: string;
}

export function MobileHeader({ 
  title, 
  subtitle, 
  showBack = false, 
  onBack, 
  rightAction,
  className 
}: MobileHeaderProps) {
  const [, setLocation] = useLocation();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  return (
    <div className={cn("bg-white border-b border-gray-200 sticky top-0 z-40", className)}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {showBack && (
            <button
              onClick={handleBack}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5 text-gray-700" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-600 truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {rightAction && (
          <div className="ml-2">
            {rightAction}
          </div>
        )}
      </div>
    </div>
  );
}
