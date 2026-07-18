interface SpectioLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
  /** Kept for API compatibility — ignored, always renders the full wordmark */
  iconOnly?: boolean;
}

export default function SpectioLogo({
  className = "",
  size = "md",
  variant = "light",
}: SpectioLogoProps) {
  const sizes = {
    sm: { fontSize: "16px", letterSpacing: "0.16em", height: 28 },
    md: { fontSize: "22px", letterSpacing: "0.18em", height: 38 },
    lg: { fontSize: "32px", letterSpacing: "0.18em", height: 56 },
  };

  const s = sizes[size];
  const color = variant === "light" ? "#ffffff" : "#0f172a";

  return (
    <span
      className={`inline-flex items-center font-['Montserrat'] font-semibold uppercase leading-none ${className}`}
      style={{
        fontSize: s.fontSize,
        letterSpacing: s.letterSpacing,
        color,
        height: s.height,
      }}
    >
      ITMAP
    </span>
  );
}
