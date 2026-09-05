import { useEffect } from "react";
import { useSeo } from "@/hooks/use-seo";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";
import SpectioLogo from "@/components/spectio-logo";
import { track, trackDwell } from "@/lib/track";

function getPersona(): "buyer" | "vendor" {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get("persona");
  if (qp === "buyer" || qp === "vendor") return qp;
  const stored = localStorage.getItem("spectio_persona");
  if (stored === "buyer" || stored === "vendor") return stored;
  return "buyer";
}

export default function Register() {
  const persona = getPersona();
  const isVendorPersona = persona === "vendor";

  useSeo({
    title: isVendorPersona ? "Register as Vendor — ITMAP" : "Register as Buyer — ITMAP",
    description: "Create a free ITMAP account with any email address. No credit card needed.",
    path: "/register",
  });

  useEffect(() => {
    track("filter_applied", { metadata: { context: "register" } });
    const endDwell = trackDwell({ metadata: { page: "register" } });
    return endDwell;
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute inset-0 ${
          isVendorPersona
            ? "bg-[radial-gradient(ellipse_at_50%_30%,rgba(139,92,246,0.10),transparent_60%)]"
            : "bg-[radial-gradient(ellipse_at_50%_30%,rgba(14,165,233,0.10),transparent_60%)]"
        }`} />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-6">
          <SpectioLogo size="lg" />
        </div>
        <PersonaRegistrationForm persona={persona} />
      </div>
    </div>
  );
}
