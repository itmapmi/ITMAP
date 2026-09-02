import { useEffect, useState } from "react";

import quadrant1 from "@/assets/registration-carousel/quadrant-1.jpg";
import quadrant2 from "@/assets/registration-carousel/quadrant-2.jpg";
import matrix1 from "@/assets/registration-carousel/matrix-1.jpg";
import matrix2 from "@/assets/registration-carousel/matrix-2.jpg";
import commentary1 from "@/assets/registration-carousel/commentary-1.jpg";

// Real product screenshots — Magic Quadrant positioning, the vendor support
// matrix (Harvey-ball comparison dots), and AI-generated market commentary —
// used to show new signups a taste of what they get before they type an
// email. Purely decorative/illustrative, so a small fixed set + client-side
// autoplay is enough; no need for the full embla carousel setup used
// elsewhere in the app.
const SLIDES = [
  { src: quadrant1, alt: "Magic Quadrant vendor positioning" },
  { src: matrix1, alt: "Vendor comparison support matrix" },
  { src: commentary1, alt: "AI-generated market commentary" },
  { src: quadrant2, alt: "Magic Quadrant vendor positioning" },
  { src: matrix2, alt: "Vendor comparison support matrix" },
];

const INTERVAL_MS = 2400;

export function RegistrationScreensCarousel({ size = 192 }: { size?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative overflow-hidden rounded-xl border border-white/10 shadow-lg shadow-black/20 bg-slate-900"
        style={{ width: size, height: size }}
        role="img"
        aria-label="Screenshots of the Magic Quadrant, vendor comparison matrix, and AI market commentary"
      >
        {SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out"
            style={{ opacity: i === index ? 1 : 0 }}
          />
        ))}
        <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 rounded-xl" />
      </div>
      <div className="flex items-center gap-1">
        {SLIDES.map((slide, i) => (
          <span
            key={slide.src + i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === index ? "w-3 bg-cyan-400" : "w-1 bg-slate-600"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
