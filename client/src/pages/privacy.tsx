import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useSeo } from "@/hooks/use-seo";

export const PRIVACY_POLICY_PATH = "/privacy-policy";
export const TERMS_OF_SERVICE_PATH = "/termsofservice";

const LAST_UPDATED = "September 5, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-semibold text-white">{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-slate-100">{children}</h3>;
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

export default function PrivacyPage() {
  useSeo({
    title: "Privacy Policy — ITMAP.ai",
    description: "How ITMAP.ai collects, uses, shares and protects your information, including data received when you sign in with Google.",
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
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated: {LAST_UPDATED}</p>

          <div className="mt-8 max-w-none">
            <P>
              This Privacy Policy explains how ITMAP.ai ("ITMAP", "we", "us") collects, uses, shares and protects
              information when you visit <A href="https://itmap.ai">itmap.ai</A>, create an account, sign in with
              Google, or otherwise use our services (together, the "Service"). It applies to every visitor, including
              people who browse without an account. By using the Service you agree to this Policy and to our{" "}
              <A href={TERMS_OF_SERVICE_PATH}>Terms of Service</A>.
            </P>

            <H2>1. Who we are</H2>
            <P>
              ITMAP.ai is an independent, AI-powered enterprise IT market-intelligence platform for technology buyers
              and vendors. ITMAP is the data controller for the personal data described in this Policy. You can reach
              us at <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A>.
            </P>

            <H2>2. Information we collect</H2>

            <H3>2.1 Information you give us</H3>
            <UL>
              <li><strong>Account data:</strong> your sign-in email address, first and last name, persona (buyer or vendor) and, if you provide it, your company name, job designation and company email address.</li>
              <li><strong>Company profile verification:</strong> if you register with a personal email provider (for example Gmail, Yahoo or Outlook) and choose to unlock research reports, news and the intelligence feed, we ask for a work email address and send a one-time verification link to it. We store whether that address has been verified.</li>
              <li><strong>Content you create:</strong> RFP projects and answers, saved comparisons, questions typed into AI chat, contact-form messages and feedback.</li>
              <li><strong>Vendor data:</strong> if you act on behalf of a technology vendor, the business contact details and product information you submit for review.</li>
            </UL>

            <H3>2.2 Information we receive when you sign in with Google</H3>
            <P>
              You may create an account or sign in using your Google Account ("Sign in with Google"). When you do, Google
              asks for your consent and then shares the following with us through Google's OAuth 2.0 service using the
              <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">openid</code>,
              <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">email</code> and
              <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">profile</code> scopes:
            </P>
            <UL>
              <li>your Google Account email address and whether Google has verified it;</li>
              <li>your name (given name and family name) as set in your Google Account;</li>
              <li>your Google profile picture URL;</li>
              <li>a unique Google Account identifier that lets us recognise the same account on later sign-ins.</li>
            </UL>
            <P>
              We use this information only to create your ITMAP account, sign you in, pre-fill your profile and, where an
              ITMAP account with the same verified email already exists, link the two so that you keep one account. We
              treat an email address verified by Google as a verified ITMAP sign-in email.
            </P>
            <P>
              <strong>We do not</strong> request access to your Gmail messages, Google Contacts, Calendar, Drive or any
              other Google data, and we never post to or modify anything in your Google Account. We do not receive or
              store your Google password. The short-lived tokens Google issues during sign-in are used once to read the
              profile fields above and are not retained.
            </P>
            <P>
              ITMAP's use of information received from Google APIs adheres to the{" "}
              <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>,
              including the Limited Use requirements. We do not sell Google user data, use it for advertising, or allow
              humans to read it except with your consent, for security purposes, to comply with law, or as part of
              aggregated, anonymised internal operations.
            </P>
            <P>
              You can review and withdraw ITMAP's access to your Google Account at any time at{" "}
              <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. Withdrawing access
              does not delete your ITMAP account; you can still sign in with the email link, or ask us to delete the
              account (see Section 8).
            </P>

            <H3>2.3 Information collected automatically</H3>
            <UL>
              <li><strong>Activity data:</strong> pages, markets, vendors and reports you view, filters and searches you use, AI chat prompts, RFPs you build, time spent and interactions.</li>
              <li><strong>Traffic and device data:</strong> random first-party visitor and session identifiers, page path, referring page, campaign (UTM) parameters, browser user agent, IP address and the approximate country, region and city derived from it.</li>
              <li><strong>Sign-in history:</strong> when you signed in, which method you used (email link or Google) and the number of sessions used before your email was verified.</li>
            </UL>
            <P>
              We do not use browser fingerprinting, request GPS location, or trust a browser-supplied IP address or location.
            </P>

            <H2>3. Cookies and similar technologies</H2>
            <UL>
              <li><strong>Session cookie</strong> (HTTP-only, secure): keeps you signed in. Deleted when you sign out or the session expires.</li>
              <li><strong>Visitor cookie</strong> (HTTP-only): a random identifier that recognises the same browser over time so that traffic statistics are not double-counted, and so that a browser's earlier visits can be associated with your account once you sign in.</li>
              <li><strong>Traffic-session cookie</strong> (HTTP-only): expires after 30 minutes of inactivity; groups page views into one visit.</li>
              <li><strong>Browser storage:</strong> we use local and session storage for preferences such as dismissed notices, the free-preview timer for anonymous visitors, and your acceptance of the Terms. These values never leave your browser except as described in Section 5.</li>
              <li><strong>Advertising measurement:</strong> pages include the Reddit conversion pixel, which sets Reddit's own cookies and reports page visits and sign-ups to Reddit so that we can measure the effectiveness of our advertising. See Section 5.</li>
            </UL>
            <P>
              You can block or delete cookies in your browser settings. Blocking the session cookie will prevent you from staying signed in.
            </P>

            <H2>4. How we use information</H2>
            <UL>
              <li>Create and administer your account, authenticate you (by email link or Google) and keep your account secure.</li>
              <li>Send transactional emails: sign-in and email-verification links, company-email verification links and service notices. We do not send marketing newsletters without a separate opt-in.</li>
              <li>Provide the Service: market landscapes, vendor scores, comparisons, reports, news, intelligence feeds, security intelligence, RFP tools and AI chat.</li>
              <li>Apply access rules, for example unlocking research reports, news and the intelligence feed once a company email has been verified.</li>
              <li>Measure traffic, geographic demand and market interest; troubleshoot, secure and improve the Service.</li>
              <li>Provide vendors with the market-interest and lead information described in Section 5 and in the Terms.</li>
              <li>Comply with legal obligations and enforce our Terms.</li>
            </UL>
            <P>
              Where the GDPR or similar laws apply, we rely on: performance of a contract (providing the Service you
              signed up for), our legitimate interests (security, analytics, product improvement, business-to-business
              marketing), your consent (Google sign-in, sharing with vendors, advertising measurement) and compliance with law.
            </P>

            <H2>5. How we share information</H2>
            <UL>
              <li><strong>Technology vendors.</strong> As set out in the Terms, when you engage with a vendor's market or products on ITMAP we may share your name, company name, job designation and business email address with that vendor, who may contact you. You can withdraw this consent at any time by emailing us.</li>
              <li><strong>Google LLC.</strong> When you choose Sign in with Google, Google processes the sign-in under the <A href="https://policies.google.com/privacy">Google Privacy Policy</A>. We do not send your ITMAP activity to Google.</li>
              <li><strong>Service providers</strong> acting on our instructions: cloud hosting and database (Replit), transactional email delivery (Resend), IP-to-location lookup (ipwho.is receives the IP address only), AI model providers that process the text of your AI chat prompts and our content pipelines, and error and performance monitoring.</li>
              <li><strong>Reddit, Inc.</strong> for advertising measurement: page visits and account sign-ups are reported through the Reddit pixel and, for sign-ups, a server-side conversion event containing a hashed email address, IP address, user agent and a random event identifier. We do not share your name, company or on-site activity with Reddit.</li>
              <li><strong>Legal and safety:</strong> where required by law, regulation, legal process or to protect the rights, property or safety of ITMAP, our users or others.</li>
              <li><strong>Business transfers:</strong> in connection with a merger, acquisition, financing or sale of assets, subject to this Policy.</li>
            </UL>
            <P>We do not sell personal data and we do not share Google user data with third parties except as necessary to provide the sign-in feature itself.</P>

            <H2>6. Data retention</H2>
            <UL>
              <li>Account and profile data are kept for as long as your account exists, then deleted or anonymised within 90 days of a deletion request, except where we must retain records by law.</li>
              <li>Verification tokens for sign-in and company-email links are single-use and are cleared as soon as they are used or replaced.</li>
              <li>Traffic records, including IP addresses, are retained indefinitely for trend analysis unless deletion is required by applicable law or you request it.</li>
              <li>Content you create (RFPs, comparisons, chat history) is kept until you delete it or your account is deleted.</li>
            </UL>

            <H2>7. Security</H2>
            <P>
              All traffic to ITMAP is encrypted with TLS. Sign-in is passwordless: we rely on single-use emailed links and
              on Google's authentication rather than storing user passwords. Verification tokens are random, single-use
              and stored so that they cannot be read from any user-facing interface. Detailed traffic intelligence and
              account administration are restricted to authorised ITMAP administrators. No method of transmission or
              storage is completely secure; please contact us immediately if you believe your account has been compromised.
            </P>

            <H2>8. Your rights and choices</H2>
            <UL>
              <li><strong>Access, correction and portability:</strong> you can view and edit your name and company profile on your Profile page and request a copy of your data by email.</li>
              <li><strong>Deletion:</strong> email <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A> from your account address to delete your account and associated personal data.</li>
              <li><strong>Google sign-in:</strong> revoke ITMAP's access at <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. You can also ask us to unlink Google from your account so that only email-link sign-in remains.</li>
              <li><strong>Vendor sharing:</strong> withdraw consent to sharing with vendors at any time by email; withdrawal does not affect data already shared.</li>
              <li><strong>Objection and restriction:</strong> where local law provides, you may object to or restrict certain processing, and you may lodge a complaint with your data-protection authority.</li>
            </UL>
            <P>We respond to verified requests within 30 days. Available rights vary by jurisdiction.</P>

            <H2>9. International transfers</H2>
            <P>
              ITMAP is operated from the United Arab Emirates and our service providers process data in the United States
              and other countries. Where required, we rely on contractual safeguards such as standard contractual clauses
              for those transfers.
            </P>

            <H2>10. Children</H2>
            <P>
              The Service is intended for business users and is not directed to anyone under 18. We do not knowingly collect
              personal data from children; if you believe a child has provided us data, contact us and we will delete it.
            </P>

            <H2>11. Changes to this Policy</H2>
            <P>
              We may update this Policy from time to time. The "Last updated" date at the top shows the current version.
              Material changes will be announced by email or an in-app notice before they take effect.
            </P>

            <H2>12. Contact us</H2>
            <P>
              Privacy questions and requests: <A href="mailto:privacy@itmap.ai">privacy@itmap.ai</A>.
              General enquiries: <A href="/contact">itmap.ai/contact</A>.
            </P>
          </div>
        </article>
      </div>
    </div>
  );
}
