import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { LEGAL_LAST_UPDATED, TERMS_OF_SERVICE_PATH } from "@shared/legal/primitives";
import { TERMS_OF_SERVICE_META, TermsOfServiceBody } from "@shared/legal/terms-of-service";
import { renderSpaLink } from "@/pages/privacy";

export default function TermsPage() {
  useSeo({
    title: TERMS_OF_SERVICE_META.title,
    description: TERMS_OF_SERVICE_META.description,
    path: TERMS_OF_SERVICE_PATH,
  });

  const [, setLocation] = useLocation();
  // wouter's location is pathname-only; the query string comes from useSearch.
  // Only same-origin paths are honoured so this can't be used as an open redirect.
  const search = useSearch();
  const requestedReturn = new URLSearchParams(search).get("returnTo");
  const returnTo =
    requestedReturn && requestedReturn.startsWith("/") && !requestedReturn.startsWith("//")
      ? requestedReturn
      : "/buyer";

  const acceptTerms = () => {
    localStorage.setItem("itmap_terms_accepted", "true");
    setLocation(returnTo);
  };

  const declineTerms = () => {
    localStorage.setItem("itmap_terms_accepted", "false");
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-[#1e2130] text-slate-200">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
        <Link href={returnTo} className="inline-flex items-center text-sm text-cyan-400 hover:text-cyan-300 mb-8">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to registration
        </Link>

        <div className="bg-slate-900/80 border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-10" data-testid="page-terms-of-service">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{TERMS_OF_SERVICE_META.heading}</h1>
          <p className="text-sm text-slate-400 mb-8">Last updated: {LEGAL_LAST_UPDATED}</p>

          <div className="max-w-none">
            <TermsOfServiceBody renderLink={renderSpaLink} />
          </div>

          <div className="mt-10 pt-8 border-t border-white/10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button
              onClick={acceptTerms}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold"
              data-testid="button-terms-agree"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              I Agree
            </Button>
            <Button
              onClick={declineTerms}
              variant="outline"
              className="flex-1 border-white/20 text-slate-300 hover:bg-white/5 hover:text-white"
              data-testid="button-terms-disagree"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Disagree
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
