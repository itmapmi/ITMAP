import type { ReactNode } from "react";
import { Link } from "wouter";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { LockedFeatureTooltip } from "@/components/locked-feature-tooltip";

export type BentoSize = "1x1" | "1x2" | "2x1" | "2x2";
export type BentoAccent = "cyan" | "violet" | "emerald" | "amber";

interface BentoCardProps {
  label: string;
  description?: string;
  icon: ReactNode;
  href?: string;
  stat?: string;
  statLabel?: string;
  locked?: boolean;
  size?: BentoSize;
  accent?: BentoAccent;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}

const sizeClasses: Record<BentoSize, string> = {
  "1x1": "",
  "1x2": "md:col-span-2",
  "2x1": "md:row-span-2",
  "2x2": "md:col-span-2 md:row-span-2",
};

const accents: Record<BentoAccent, {
  icon: string;
  iconBg: string;
  border: string;
  glow: string;
  stat: string;
}> = {
  cyan: {
    icon: "text-cyan-400",
    iconBg: "bg-cyan-500/10",
    border: "group-hover:border-cyan-500/40",
    glow: "group-hover:shadow-[0_0_40px_rgba(14,165,233,0.08)]",
    stat: "text-cyan-400",
  },
  violet: {
    icon: "text-violet-400",
    iconBg: "bg-violet-500/10",
    border: "group-hover:border-violet-500/40",
    glow: "group-hover:shadow-[0_0_40px_rgba(139,92,246,0.08)]",
    stat: "text-violet-400",
  },
  emerald: {
    icon: "text-emerald-400",
    iconBg: "bg-emerald-500/10",
    border: "group-hover:border-emerald-500/40",
    glow: "group-hover:shadow-[0_0_40px_rgba(52,211,153,0.08)]",
    stat: "text-emerald-400",
  },
  amber: {
    icon: "text-amber-400",
    iconBg: "bg-amber-500/10",
    border: "group-hover:border-amber-500/40",
    glow: "group-hover:shadow-[0_0_40px_rgba(251,191,36,0.08)]",
    stat: "text-amber-400",
  },
};

export function BentoCard({
  label,
  description,
  icon,
  href,
  stat,
  statLabel,
  locked = false,
  size = "1x1",
  accent = "cyan",
  children,
  onClick,
  className,
}: BentoCardProps) {
  const a = accents[accent];
  const spanCn = sizeClasses[size];

  // The visual card content — same markup regardless of lock/nav state
  const cardContent = (
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border p-5 transition-all duration-200 h-full min-h-[120px]",
        locked
          ? cn(
              "border-white/5 bg-slate-900/40 opacity-70",
              href
                ? "cursor-pointer hover:opacity-80 hover:border-white/10"
                : "cursor-default",
            )
          : cn(
              "border-white/8 bg-slate-900 cursor-pointer",
              a.border,
              a.glow,
            ),
        className,
      )}
      onClick={!locked ? onClick : undefined}
    >
      {/* Lock badge */}
      {locked && (
        <span className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
          <Lock className="h-2.5 w-2.5" /> Locked
        </span>
      )}

      {/* Icon */}
      <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", locked ? "bg-white/5" : a.iconBg)}>
        <span className={cn("h-5 w-5", locked ? "text-slate-500 grayscale" : a.icon)}>
          {icon}
        </span>
      </div>

      {/* Label + description */}
      <div className="flex-1">
        <p className={cn("font-semibold text-sm", locked ? "text-slate-500" : "text-white")}>{label}</p>
        {description && (
          <p className={cn("mt-0.5 text-xs leading-relaxed", locked ? "text-slate-600" : "text-slate-400")}>
            {description}
          </p>
        )}
      </div>

      {/* Stat */}
      {stat && (
        <div className="mt-auto">
          <p className={cn("text-xl font-bold tabular-nums", locked ? "text-slate-600" : a.stat)}>{stat}</p>
          {statLabel && <p className="text-[11px] text-slate-500 mt-0.5">{statLabel}</p>}
        </div>
      )}

      {children}
    </div>
  );

  // Build inner content: locked cards navigate to href so the destination
  // LockedFeaturePanel handles gating; tooltip remains as a hover affordance.
  let inner: ReactNode;
  if (locked) {
    const wrapped = href
      ? <Link href={href} className="block h-full">{cardContent}</Link>
      : cardContent;
    inner = <LockedFeatureTooltip>{wrapped}</LockedFeatureTooltip>;
  } else if (href) {
    inner = <Link href={href} className="block h-full">{cardContent}</Link>;
  } else {
    inner = cardContent;
  }

  // Outer wrapper applies grid spanning only; empty string means no extra div needed
  return spanCn ? <div className={spanCn}>{inner}</div> : <>{inner}</>;
}
