interface SpectioLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
  iconOnly?: boolean;
}

export default function SpectioLogo({
  className = "",
  size = "md",
  variant = "light",
  iconOnly = false,
}: SpectioLogoProps) {
  const heights = { sm: 44, md: 60, lg: 88 };
  const h = heights[size];

  // "light" = used on dark backgrounds → white wordmark
  // "dark"  = used on light backgrounds → navy wordmark
  const wordmarkFill = variant === "light" ? "#FFFFFF" : "#0F1729";
  const accentFill = "#22D3EE";

  if (iconOnly) {
    return (
      <svg
        viewBox="0 0 220 220"
        height={h}
        style={{ height: h, width: "auto" }}
        className={className}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="spectio.ai"
      >
        <g transform="translate(110, 110)">
          <path
            d="M 0 -70 Q 8 -70, 14 -64 L 64 -14 Q 70 -8, 70 0 Q 70 8, 64 14 L 14 64 Q 8 70, 0 70 Q -8 70, -14 64 L -64 14 Q -70 8, -70 0 Q -70 -8, -64 -14 L -14 -64 Q -8 -70, 0 -70 Z"
            fill="#22D3EE"
            stroke="#0F1729"
            strokeWidth={3}
          />
          <path
            d="M -38 0 Q -20 -20, 0 -20 Q 20 -20, 38 0 Q 20 20, 0 20 Q -20 20, -38 0 Z"
            fill="#E0F2FE"
          />
          <circle cx={0} cy={0} r={11} fill="#A4133C" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 680 220"
      height={h}
      style={{ height: h, width: "auto" }}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="spectio.ai"
    >
      <g transform="translate(110, 110)">
        <path
          d="M 0 -70 Q 8 -70, 14 -64 L 64 -14 Q 70 -8, 70 0 Q 70 8, 64 14 L 14 64 Q 8 70, 0 70 Q -8 70, -14 64 L -64 14 Q -70 8, -70 0 Q -70 -8, -64 -14 L -14 -64 Q -8 -70, 0 -70 Z"
          fill="#22D3EE"
          stroke="#0F1729"
          strokeWidth={3}
        />
        <path
          d="M -38 0 Q -20 -20, 0 -20 Q 20 -20, 38 0 Q 20 20, 0 20 Q -20 20, -38 0 Z"
          fill="#E0F2FE"
        />
        <circle cx={0} cy={0} r={11} fill="#A4133C" />
      </g>
      <text
        x={225}
        y={135}
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize={68}
        fontWeight={600}
        letterSpacing={-1.5}
      >
        <tspan fill={wordmarkFill}>Spectio</tspan>
        <tspan fill={accentFill}>.ai</tspan>
      </text>
    </svg>
  );
}
