import { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  color?: "blue" | "purple" | "green" | "orange" | "red";
  testId?: string;
}

const colorClasses = {
  blue: "bg-blue-50 text-blue-600",
  purple: "bg-purple-50 text-purple-600",
  green: "bg-green-50 text-green-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
};

export function QuickActionCard({ 
  title, 
  description, 
  icon: Icon, 
  href, 
  color = "blue",
  testId 
}: QuickActionCardProps) {
  return (
    <Link href={href}>
      <a
        data-testid={testId}
        className="block bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow active:bg-gray-50"
      >
        <div className="flex items-start gap-4">
          <div className={cn("p-3 rounded-lg", colorClasses[color])}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-base">{title}</h3>
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{description}</p>
          </div>
        </div>
      </a>
    </Link>
  );
}
