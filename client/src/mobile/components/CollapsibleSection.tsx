import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  testId?: string;
}

export function CollapsibleSection({ 
  title, 
  children, 
  defaultOpen = false,
  icon,
  testId 
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
        data-testid={testId}
      >
        <div className="flex items-center gap-3">
          {icon && <div className="text-gray-700">{icon}</div>}
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>
        <ChevronDown 
          className={cn(
            "h-5 w-5 text-gray-500 transition-transform",
            isOpen && "transform rotate-180"
          )}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}
