import type { LucideIcon } from "lucide-react";

interface MarketSectionHeaderProps {
  title: string;
  description?: string;
  icon: LucideIcon;
  headingId?: string;
  tone?: "blue" | "violet" | "amber" | "rose";
}

const themes = {
  blue: { header: "border-blue-100 from-blue-50 to-purple-50", title: "text-blue-900", icon: "text-blue-500" },
  violet: { header: "border-violet-100 from-violet-50 to-fuchsia-50", title: "text-violet-900", icon: "text-violet-600" },
  amber: { header: "border-amber-100 from-amber-50 to-orange-50", title: "text-amber-900", icon: "text-amber-600" },
  rose: { header: "border-rose-100 from-rose-50 to-pink-50", title: "text-rose-900", icon: "text-rose-600" },
};

export default function MarketSectionHeader({ title, description, icon: Icon, headingId, tone = "blue" }: MarketSectionHeaderProps) {
  const theme = themes[tone];
  return (
    <header
      className={`flex flex-col space-y-1.5 border-b bg-gradient-to-r p-6 ${theme.header}`}
      data-testid="market-section-header"
    >
      <h2 id={headingId} className={`flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight ${theme.title}`}>
        <Icon className={`h-5 w-5 shrink-0 ${theme.icon}`} aria-hidden="true" />
        {title}
      </h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}