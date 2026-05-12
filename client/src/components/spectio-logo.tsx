import logoLight from "@assets/spectio-ai-logo-transparent_1778569854412.jpg";
import logoDark from "@assets/spectio-ai-logo-dark_1778569854413.jpg";
import iconOnly from "@assets/spectio-ai-icon_1778569854412.jpg";

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
  iconOnly: iconOnlyProp = false,
}: SpectioLogoProps) {
  // "light" = used on dark backgrounds → use white-text logo
  // "dark"  = used on light backgrounds → use navy-text logo
  const heights = { sm: 22, md: 28, lg: 36 };
  const h = heights[size];

  if (iconOnlyProp) {
    return (
      <img
        src={iconOnly}
        alt="spectio.ai"
        height={h}
        style={{ height: h, width: "auto" }}
        className={className}
      />
    );
  }

  const src = variant === "dark" ? logoLight : logoDark;
  return (
    <img
      src={src}
      alt="spectio.ai"
      height={h}
      style={{ height: h, width: "auto" }}
      className={className}
    />
  );
}
