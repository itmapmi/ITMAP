import { LucideIcon } from "lucide-react";

interface MobileEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function MobileEmptyState({ icon: Icon, title, description, action }: MobileEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="bg-gray-100 rounded-full p-6 mb-4">
        <Icon className="h-12 w-12 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600 max-w-xs mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          data-testid="button-empty-state-action"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
