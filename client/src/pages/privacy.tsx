import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useSeo } from "@/hooks/use-seo";
import { LEGAL_LAST_UPDATED, PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH, type RenderLink } from "@shared/legal/primitives";
import { PRIVACY_POLICY_META, PrivacyPolicyBody } from "@shared/legal/privacy-policy";

export { PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH };

// Internal links inside the shared body use the SPA router; the server-side
// render of the same body falls back to plain anchors.
export const renderSpaLink: RenderLink = (href, children, className) => (
  <Link href={href} className={className}>{children}</Link>
);

export default function PrivacyPage() {
  useSeo({
    title: PRIVACY_POLICY_META.title,
    description: PRIVACY_POLICY_META.description,
    path: PRIVACY_POLICY_PATH,
  });

  return (
    <div className="min-h-screen bg-[#1e2130] text-slate-200">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
        <Link href="/" className="mb-8 inline-flex items-center text-sm text-cyan-400 transition-colors hover:text-cyan-300">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to ITMAP
        </Link>

        <article className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl sm:p-10" data-testid="page-privacy-policy">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{PRIVACY_POLICY_META.heading}</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated: {LEGAL_LAST_UPDATED}</p>

          <div className="mt-8 max-w-none">
            <PrivacyPolicyBody renderLink={renderSpaLink} />
          </div>
        </article>
      </div>
    </div>
  );
}
