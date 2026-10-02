import type { LucideIcon } from "lucide-react";

interface MarketSectionHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  headingId?: string;
}

export default function MarketSectionHeader({ title, description, icon: Icon, headingId }: MarketSectionHeaderProps) {
  return (
    <header
      className="flex flex-col space-y-1.5 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-purple-50 p-6"
      data-testid="market-section-header"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
        <Icon className="h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}