import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

export default function TermsPage() {
  useSeo({
    title: "Terms of Service — ITMAP.ai",
    description: "ITMAP.ai Terms of Service. By creating an account, you agree to these terms.",
    path: "/terms",
  });

  const [location, setLocation] = useLocation();
  const returnTo = new URLSearchParams(location.split("?")[1]).get("returnTo") || "/buyer";

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

        <div className="bg-slate-900/80 border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">ITMAP.ai — Terms of Service</h1>
          <p className="text-sm text-slate-400 mb-8">Last updated: July 19, 2026</p>

          <div className="prose prose-invert prose-slate max-w-none">
            <p className="text-slate-300">
              By clicking <strong>"I Agree"</strong> and creating an account, you accept these Terms. If you do not agree, click <strong>"Disagree"</strong> and do not use the platform.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. The Service</h2>
            <p className="text-slate-300">
              ITMAP.ai provides AI-generated IT market intelligence, including vendor landscapes, product comparisons, vendor scores, news intelligence, RFP generation, and related tools ("the Service"). The Service is currently provided <strong>free of charge</strong> to end users. We may modify, gate, or discontinue any feature at any time.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. AI-Generated Content — No Warranty</h2>
            <p className="text-slate-300">
              Content on ITMAP.ai — including vendor scores, landscape placements, comparisons, forecasts, and commentary — is <strong>generated and updated by automated AI systems</strong> using publicly available information. It is provided <strong>"as is," for informational purposes only</strong>, and may contain errors, omissions, or outdated information.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li>ITMAP.ai content is <strong>not professional, financial, legal, or purchasing advice</strong>.</li>
              <li>You are solely responsible for independently verifying information before making any purchasing, investment, or business decision.</li>
              <li>We make no warranties of accuracy, completeness, fitness for a particular purpose, or merchantability.</li>
            </ul>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Data We Collect</h2>
            <p className="text-slate-300">When you use the Service, we collect:</p>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li><strong>Account data</strong>: your name, company name, email address, and job role.</li>
              <li><strong>Activity data</strong>: markets and reports you browse, searches and chat queries, RFPs you create, datasheets you compare, and similar usage and sentiment signals.</li>
            </ul>
            <p className="text-slate-300">We use this data to operate and improve the Service and for the purposes described in Section 4.</p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Sharing Your Data with Vendors — Please Read</h2>
            <p className="text-slate-300">
              <strong>By agreeing to these Terms, you consent to ITMAP.ai sharing your name, company name, and email address with technology vendors whose markets or products you engage with on the platform.</strong> Vendors may contact you regarding their products and services. We do not sell your browsing history verbatim, but vendors may be informed of your general interest in a market category.
            </p>
            <p className="text-slate-300">
              You may withdraw this consent at any time by emailing <a href="mailto:privacy@itmap.ai" className="text-cyan-400 hover:text-cyan-300">privacy@itmap.ai</a> or adjusting your account settings. Withdrawal does not affect data already shared.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">5. Your Responsibilities</h2>
            <p className="text-slate-300">
              You agree to: provide accurate registration information; use the Service only for lawful business purposes; and not scrape, resell, reverse-engineer, or redistribute ITMAP.ai content or data without written permission.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">6. Intellectual Property</h2>
            <p className="text-slate-300">
              All platform content, scores, models, and reports are the property of ITMAP.ai. We grant you a limited, non-exclusive, non-transferable license to use the Service for your internal business purposes only.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">7. Limitation of Liability</h2>
            <p className="text-slate-300">
              To the maximum extent permitted by law, ITMAP.ai and its affiliates and partners shall not be liable for any indirect, incidental, consequential, or special damages, or for any loss of profits, revenue, data, or business opportunity, arising from your use of (or inability to use) the Service or reliance on its content. Our total aggregate liability for any claim shall not exceed <strong>USD 100</strong>.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">8. Indemnification</h2>
            <p className="text-slate-300">
              You agree to indemnify and hold harmless ITMAP.ai from claims arising out of your misuse of the Service or violation of these Terms.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">9. Termination</h2>
            <p className="text-slate-300">
              We may suspend or terminate your account at any time for violation of these Terms. You may delete your account at any time; deletion requests can be sent to <a href="mailto:privacy@itmap.ai" className="text-cyan-400 hover:text-cyan-300">privacy@itmap.ai</a>.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">10. Changes to These Terms</h2>
            <p className="text-slate-300">
              We may update these Terms from time to time. Material changes will be notified via email or in-platform notice. Continued use after changes constitutes acceptance.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">11. Governing Law</h2>
            <p className="text-slate-300">
              These Terms are governed by the laws of <strong>[the United Arab Emirates]</strong>, and disputes shall be resolved in the courts of that jurisdiction.
            </p>

            <h2 className="text-xl font-semibold text-white mt-8 mb-3">12. Contact</h2>
            <p className="text-slate-300">
              Questions: <a href="mailto:legal@itmap.ai" className="text-cyan-400 hover:text-cyan-300">legal@itmap.ai</a>
            </p>
          </div>

          <div className="mt-10 pt-8 border-t border-white/10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button
              onClick={acceptTerms}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              I Agree
            </Button>
            <Button
              onClick={declineTerms}
              variant="outline"
              className="flex-1 border-white/20 text-slate-300 hover:bg-white/5 hover:text-white"
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
