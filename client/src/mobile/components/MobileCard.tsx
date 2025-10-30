import { cn } from "@/lib/utils";

interface MobileCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: string;
}

export function MobileCard({ children, className, onClick, testId }: MobileCardProps) {
  const isClickable = !!onClick;

  return (
    <div
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden",
        isClickable && "active:bg-gray-50 transition-colors cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}

export function MobileCardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-4 border-b border-gray-100", className)}>{children}</div>;
}

export function MobileCardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

export function MobileCardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-lg font-semibold text-gray-900", className)}>{children}</h3>;
}

export function MobileCardDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-gray-600 mt-1", className)}>{children}</p>;
}
