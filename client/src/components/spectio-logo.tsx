interface SpectioLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
}

export default function SpectioLogo({ className = "", size = "md", variant = "light" }: SpectioLogoProps) {
  const sizes = { sm: { icon: 22, text: "text-lg" }, md: { icon: 28, text: "text-xl" }, lg: { icon: 36, text: "text-2xl" } };
  const s = sizes[size];
  const textColor = variant === "dark" ? "text-slate-900" : "text-white";
  const dotColor = variant === "dark" ? "text-cyan-600" : "text-cyan-400";

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width={s.icon} height={s.icon} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sg1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
          <linearGradient id="sg2" x1="36" y1="0" x2="0" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r="16" stroke="url(#sg2)" strokeWidth="1.5" />
        <circle cx="18" cy="18" r="10" stroke="url(#sg1)" strokeWidth="2" />
        <circle cx="18" cy="18" r="4.5" fill="url(#sg1)" />
        <circle cx="18" cy="18" r="2" fill="white" />
        <line x1="18" y1="2" x2="18" y2="7" stroke="url(#sg1)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="18" y1="29" x2="18" y2="34" stroke="url(#sg1)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="2" y1="18" x2="7" y2="18" stroke="url(#sg1)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="29" y1="18" x2="34" y2="18" stroke="url(#sg1)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className={`${s.text} font-bold tracking-tight ${textColor}`}>
        spectio<span className={dotColor}>.ai</span>
      </span>
    </div>
  );
}
