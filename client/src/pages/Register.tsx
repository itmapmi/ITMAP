import { useEffect } from "react";
import { useSeo } from "@/hooks/use-seo";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";
import SpectioLogo from "@/components/spectio-logo";
import { track, trackDwell } from "@/lib/track";

export default function Register() {
  useSeo({
    title: "Sign up — ITMAP",
    description: "Create a free ITMAP account with any email address. No credit card needed.",
    path: "/register",
  });

  useEffect(() => {
    // Old links and bookmarks may still carry ?persona=buyer|vendor. There is
    // a single sign-up now, so drop it from the address bar (and forget any
    // persona a previous visit stored) without triggering a navigation.
    const url = new URL(window.location.href);
    if (url.searchParams.has("persona")) {
      url.searchParams.delete("persona");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    localStorage.removeItem("spectio_persona");

    track("filter_applied", { metadata: { context: "register" } });
    const endDwell = trackDwell({ metadata: { page: "register" } });
    return endDwell;
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(14,165,233,0.10),transparent_60%)]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-6">
          <SpectioLogo size="lg" />
        </div>
        {/* The standalone sign-up page is a dead end after Google — go home instead. */}
        <PersonaRegistrationForm googleReturnTo="/" />
      </div>
    </div>
  );
}
