import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH } from "@/pages/privacy";

const LAST_UPDATED = "September 5, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 mb-3 text-xl font-semibold text-white">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-slate-300 leading-relaxed">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">{children}</ul>;
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:/.test(href);
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">{children}</a>
  ) : (
    <Link href={href} className="text-cyan-400 hover:text-cyan-300">{children}</Link>
  );
}

export default function TermsPage() {
  useSeo({
    title: "Terms of Service — ITMAP.ai",
    description: "ITMAP.ai Terms of Service, covering accounts, Sign in with Google, AI-generated content, vendor data sharing and acceptable use.",
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
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">ITMAP.ai — Terms of Service</h1>
          <p className="text-sm text-slate-400 mb-8">Last updated: {LAST_UPDATED}</p>

          <div className="max-w-none">
            <P>
              These Terms of Service ("Terms") are a binding agreement between you and ITMAP.ai ("ITMAP", "we", "us")
              governing your use of <A href="https://itmap.ai">itmap.ai</A> and the related services, content and tools
              (the "Service"). By creating an account — whether by entering your email address or by clicking{" "}
              <strong>Continue with Google</strong> — or by using the Service, you accept these Terms and our{" "}
              <A href={PRIVACY_POLICY_PATH}>Privacy Policy</A>. If you do not agree, do not use the Service.
            </P>
            <P>
              If you use the Service on behalf of a company, you represent that you are authorised to bind that company
              to these Terms, and "you" includes that company.
            </P>

            <H2>1. The Service</H2>
            <P>
              ITMAP.ai provides AI-generated enterprise IT market intelligence, including vendor landscapes, product
              comparisons, vendor scores, research reports, news and intelligence feeds, security intelligence, RFP
              generation, AI chat and related tools. The Service is currently provided <strong>free of charge</strong> to
              end users. We may add, modify, gate or discontinue any feature at any time.
            </P>

            <H2>2. Eligibility</H2>
            <P>
              The Service is intended for business use. You must be at least 18 years old and able to form a binding
              contract. You may not use the Service if you are barred from doing so under applicable law.
            </P>

            <H2>3. Accounts and sign-in</H2>
            <UL>
              <li><strong>Passwordless sign-in.</strong> ITMAP does not use passwords. You sign in either with a single-use link sent to your email address or through Sign in with Google. You are responsible for keeping your email account and Google Account secure; anyone with access to them can access your ITMAP account.</li>
              <li><strong>Email verification.</strong> When you register with an email address we send a verification link. You may use the Service for a limited number of sessions before verifying; after that, verification is required to continue.</li>
              <li><strong>Sign-in email.</strong> The email address you register with (or the address of the Google Account you sign in with) is your account identity and cannot be changed from within the Service. Contact us if you need to move your account to a different address.</li>
              <li><strong>Company profile.</strong> Accounts registered with a personal email provider (for example Gmail, Yahoo or Outlook) can access most of the Service immediately. Research reports, news and the intelligence feed are unlocked, free of charge, once you complete a short company profile and verify a work email address by clicking the link we send to it. A work email address may be verified on one account only. Your sign-in email does not change.</li>
              <li><strong>Accurate information.</strong> You agree to provide accurate, current information, including your name, company name, job designation and business email, and to keep it up to date.</li>
              <li><strong>One person per account.</strong> Accounts are personal and may not be shared. You are responsible for all activity under your account.</li>
            </UL>

            <H2>4. Sign in with Google</H2>
            <P>
              If you choose to register or sign in with your Google Account:
            </P>
            <UL>
              <li>You authorise Google to share with ITMAP your Google Account email address, its verification status, your name, your profile picture and a unique account identifier, as described in our <A href={PRIVACY_POLICY_PATH}>Privacy Policy</A>. We request no other Google data and cannot access your Gmail, Contacts, Drive or other Google services.</li>
              <li>We use this information solely to create and secure your ITMAP account, sign you in, pre-fill your profile and link it with any existing ITMAP account that has the same verified email address.</li>
              <li>ITMAP's use of information received from Google APIs adheres to the <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, including its Limited Use requirements.</li>
              <li>Your use of Google is governed by Google's own terms and privacy policy. ITMAP is not responsible for Google's services, and Google is not a party to these Terms.</li>
              <li>You may revoke ITMAP's access at any time at <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. Revoking access does not delete your ITMAP account; you can continue to sign in with the email link or ask us to delete the account.</li>
              <li>If Google reports your email address as unverified, we will not create or link an account with it.</li>
            </UL>

            <H2>5. AI-generated content — no warranty</H2>
            <P>
              Content on ITMAP.ai — including vendor scores, landscape placements, comparisons, forecasts, report
              summaries, news classification, security intelligence and AI chat answers — is{" "}
              <strong>generated and updated by automated AI systems</strong> using publicly available information and
              vendor-submitted material. It is provided <strong>"as is", for informational purposes only</strong>, and
              may contain errors, omissions or outdated information.
            </P>
            <UL>
              <li>ITMAP.ai content is <strong>not professional, financial, legal, security or purchasing advice</strong>.</li>
              <li>You are solely responsible for independently verifying information before making any purchasing, investment, security or business decision.</li>
              <li>Vendor placements and scores are not endorsements and are not influenced by payment from vendors.</li>
              <li>We make no warranties of accuracy, completeness, fitness for a particular purpose, non-infringement or merchantability.</li>
            </UL>

            <H2>6. Data we collect and how we use it</H2>
            <P>
              We collect account data (name, company name, designation, sign-in email and company email), information
              received from Google when you use Sign in with Google, activity data (markets, reports and vendors you view,
              searches, AI chat prompts, RFPs and comparisons) and traffic and device data (random first-party visitor
              and session identifiers, page paths, referring page, campaign parameters, browser user agent, IP address
              and approximate location derived from it). Collection begins when a page loads, including for anonymous
              visitors. We use this data to operate, secure, analyse and improve the Service, to send transactional
              emails, to apply access rules, for advertising measurement and for the purposes in Section 7. Full details,
              retention periods and your rights are in our <A href={PRIVACY_POLICY_PATH}>Privacy Policy</A>, which forms part of these Terms.
            </P>

            <H2>7. Sharing your data with vendors — please read</H2>
            <P>
              <strong>By agreeing to these Terms, you consent to ITMAP.ai sharing your name, company name, job designation
              and business email address with technology vendors whose markets or products you engage with on the
              platform.</strong> Vendors may contact you regarding their products and services. We do not sell your
              browsing history, but vendors may be informed of your general interest in a market category.
            </P>
            <P>
              You may withdraw this consent at any time by emailing <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A>.
              Withdrawal does not affect data already shared. Information received from Google is never shared with vendors
              beyond the name and email address that also form part of your ITMAP account data.
            </P>

            <H2>8. Acceptable use</H2>
            <P>You agree not to:</P>
            <UL>
              <li>scrape, crawl, bulk-download, resell, sublicense or redistribute ITMAP content or data, or use it to train machine-learning models, without our written permission;</li>
              <li>reverse-engineer, probe or interfere with the Service, its security or its access controls, or circumvent feature gates such as email or company-email verification;</li>
              <li>register with an email address you do not control, impersonate any person or company, or create accounts on behalf of others without authority;</li>
              <li>submit false, misleading or infringing vendor information, reviews or fact-review responses;</li>
              <li>use the Service for any unlawful purpose or in breach of export-control or sanctions laws.</li>
            </UL>

            <H2>9. Vendor accounts</H2>
            <P>
              If you access the Service as a vendor representative, you warrant that you are authorised by that vendor,
              that information you submit is accurate and non-infringing, and you grant ITMAP a worldwide,
              royalty-free licence to use, display and analyse that information within the Service. Vendor access to
              buyer information is limited to what these Terms and the Privacy Policy allow.
            </P>

            <H2>10. Intellectual property</H2>
            <P>
              The Service, its content, scores, models, reports and trademarks are owned by ITMAP.ai or its licensors.
              We grant you a limited, revocable, non-exclusive, non-transferable licence to use the Service and to use
              content you legitimately access for your internal business purposes. Content you create (for example RFPs)
              remains yours; you grant us a licence to host and process it to provide the Service.
            </P>

            <H2>11. Third-party services</H2>
            <P>
              The Service relies on third parties including Google (sign-in), email delivery providers, cloud hosting and
              AI model providers, and may link to external websites. We are not responsible for third-party services or
              content, and your use of them is subject to their own terms.
            </P>

            <H2>12. Disclaimer of warranties</H2>
            <P>
              The Service is provided "as is" and "as available". To the maximum extent permitted by law we disclaim all
              warranties, express or implied, including uninterrupted or error-free operation and the accuracy of any content.
            </P>

            <H2>13. Limitation of liability</H2>
            <P>
              To the maximum extent permitted by law, ITMAP.ai and its affiliates, officers, employees and partners shall
              not be liable for any indirect, incidental, consequential, special or punitive damages, or for any loss of
              profits, revenue, data or business opportunity, arising from your use of (or inability to use) the Service
              or reliance on its content. Our total aggregate liability for any claim shall not exceed <strong>USD 100</strong>.
            </P>

            <H2>14. Indemnification</H2>
            <P>
              You agree to indemnify and hold harmless ITMAP.ai from claims, losses and expenses (including reasonable
              legal fees) arising out of your misuse of the Service, content you submit or your violation of these Terms.
            </P>

            <H2>15. Suspension and termination</H2>
            <P>
              We may suspend or terminate your account at any time for violation of these Terms or to protect the Service.
              You may stop using the Service at any time and may request deletion of your account by emailing{" "}
              <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A>. Sections 5, 7 (as to data already shared), 10 and 12–17 survive termination.
            </P>

            <H2>16. Changes to these Terms</H2>
            <P>
              We may update these Terms from time to time. Material changes will be notified by email or an in-app notice
              before they take effect. Continued use after changes constitutes acceptance.
            </P>

            <H2>17. Governing law and disputes</H2>
            <P>
              These Terms are governed by the laws of the <strong>United Arab Emirates</strong>, and disputes shall be
              resolved exclusively in the courts of that jurisdiction, without prejudice to any mandatory consumer rights
              you may have under the laws of your country of residence.
            </P>

            <H2>18. Contact</H2>
            <P>
              Legal questions: <A href="mailto:legal@itmap.ai">legal@itmap.ai</A>. Privacy requests:{" "}
              <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A>.
            </P>
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
