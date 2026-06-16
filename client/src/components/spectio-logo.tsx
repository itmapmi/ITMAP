import dcigWhite from "@assets/DCIG-Logo-WHITE_1781593294046.png";
import dcigBlue from "@assets/images_(1)_1781593357016.jpg";

interface SpectioLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
  /** Kept for API compatibility — ignored, always renders the full logo */
  iconOnly?: boolean;
}

export default function SpectioLogo({
  className = "",
  size = "md",
  variant = "light",
}: SpectioLogoProps) {
  const heights = { sm: 28, md: 38, lg: 56 };
  const h = heights[size];

  // "light" → dark background → white DCIG logo
  // "dark"  → light/white background → navy DCIG logo
  const src = variant === "light" ? dcigWhite : dcigBlue;

  return (
    <img
      src={src}
      alt="DCIG"
      style={{ height: h, width: "auto", objectFit: "contain" }}
      className={className}
    />
  );
}
