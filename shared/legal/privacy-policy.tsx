import React from "react";
import { makeLegalPrimitives, type RenderLink, TERMS_OF_SERVICE_PATH } from "./primitives";

// Privacy Policy body — shared by the React page (client) and the server-rendered
// HTML at /privacy-policy. See ./primitives.tsx for why this must stay free of hooks,
// router imports and browser globals.

export const PRIVACY_POLICY_META = {
  title: "Privacy Policy — ITMAP.ai",
  heading: "Privacy Policy",
  description:
    "How ITMAP.ai collects, uses, shares and protects your information, including data received when you sign in with Google.",
};

export function PrivacyPolicyBody({
  renderLink,
  t = (_key, defaultValue) => defaultValue,
}: {
  renderLink?: RenderLink;
  t?: (key: string, defaultValue: string) => string;
} = {}) {
  const { H2, H3, P, UL, A } = makeLegalPrimitives(renderLink);
  return (
    <>

      <P>
        {t("privacy.intro.beforeSite", 'This Privacy Policy explains how ITMAP.ai ("ITMAP", "we", "us") collects, uses, shares and protects information when you visit')}{" "}
        <A href="https://itmap.ai">{t("privacy.intro.siteName", "itmap.ai")}</A>
        {t("privacy.intro.afterSite", ', create an account, sign in with Google, or otherwise use our services (together, the "Service"). It applies to every visitor, including people who browse without an account. By using the Service you agree to this Policy and to our')}{" "}
        <A href={TERMS_OF_SERVICE_PATH}>{t("privacy.intro.termsLink", "Terms of Service")}</A>.
      </P>

      <H2>{t("privacy.whoWeAre.heading", "1. Who we are")}</H2>
      <P>
        {t("privacy.whoWeAre.descriptionBeforeEmail", "ITMAP.ai is an independent, AI-powered enterprise IT market-intelligence platform for technology buyers and vendors. ITMAP is the data controller for the personal data described in this Policy. You can reach us at")}{" "}
        <A href="mailto:privacy@itmap.ai">{t("privacy.whoWeAre.email", "privacy@itmap.ai")}</A>.
      </P>

      <H2>{t("privacy.information.heading", "2. Information we collect")}</H2>

      <H3>{t("privacy.information.providedHeading", "2.1 Information you give us")}</H3>
      <UL>
        <li><strong>{t("privacy.information.provided.accountTitle", "Account data:")}</strong> {t("privacy.information.provided.accountText", "your sign-in email address, first and last name and, if you provide it, your company name, job designation and company email address.")}</li>
        <li><strong>{t("privacy.information.provided.companyVerificationTitle", "Company profile verification:")}</strong> {t("privacy.information.provided.companyVerificationText", "if you register with a personal email provider (for example Gmail, Yahoo or Outlook) and choose to unlock research reports, news and the intelligence feed, we ask for a work email address and send a one-time verification link to it. We store whether that address has been verified.")}</li>
        <li><strong>{t("privacy.information.provided.contentTitle", "Content you create:")}</strong> {t("privacy.information.provided.contentText", "RFP projects and answers, saved comparisons, questions typed into AI chat, contact-form messages and feedback.")}</li>
        <li><strong>{t("privacy.information.provided.vendorTitle", "Vendor data:")}</strong> {t("privacy.information.provided.vendorText", "if you act on behalf of a technology vendor, the business contact details and product information you submit for review.")}</li>
      </UL>

      <H3>{t("privacy.information.googleHeading", "2.2 Information we receive when you sign in with Google")}</H3>
      <P>
        {t("privacy.information.googleIntroBeforeScopes", 'You may create an account or sign in using your Google Account ("Sign in with Google"). When you do, Google asks for your consent and then shares the following with us through Google\'s OAuth 2.0 service using the')}
        {" "}
        <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">openid</code>,
        <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">email</code> and
        <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-200">profile</code> scopes:
      </P>
      <UL>
        <li>{t("privacy.information.googleItems.email", "your Google Account email address and whether Google has verified it;")}</li>
        <li>{t("privacy.information.googleItems.name", "your name (given name and family name) as set in your Google Account;")}</li>
        <li>{t("privacy.information.googleItems.picture", "your Google profile picture URL;")}</li>
        <li>{t("privacy.information.googleItems.identifier", "a unique Google Account identifier that lets us recognise the same account on later sign-ins.")}</li>
      </UL>
      <P>
        {t("privacy.information.googleUse", "We use this information only to create your ITMAP account, sign you in, pre-fill your profile and, where an ITMAP account with the same verified email already exists, link the two so that you keep one account. We treat an email address verified by Google as a verified ITMAP sign-in email.")}
      </P>
      <P>
        <strong>{t("privacy.information.googleNoAccessEmphasis", "We do not")}</strong>{" "}
        {t("privacy.information.googleNoAccess", "request access to your Gmail messages, Google Contacts, Calendar, Drive or any other Google data, and we never post to or modify anything in your Google Account. We do not receive or store your Google password. The short-lived tokens Google issues during sign-in are used once to read the profile fields above and are not retained.")}
      </P>
      <P>
        {t("privacy.information.googlePolicyBeforeLink", "ITMAP's use of information received from Google APIs adheres to the")}{" "}
        <A href="https://developers.google.com/terms/api-services-user-data-policy">{t("privacy.information.googlePolicyLink", "Google API Services User Data Policy")}</A>
        {t("privacy.information.googlePolicyAfterLink", ", including the Limited Use requirements. We do not sell Google user data, use it for advertising, or allow humans to read it except with your consent, for security purposes, to comply with law, or as part of aggregated, anonymised internal operations.")}
      </P>
      <P>
        {t("privacy.information.googleRevokeBeforeLink", "You can review and withdraw ITMAP's access to your Google Account at any time at")}{" "}
        <A href="https://myaccount.google.com/permissions">{t("privacy.information.permissionsLink", "myaccount.google.com/permissions")}</A>
        {t("privacy.information.googleRevokeAfterLink", ". Withdrawing access does not delete your ITMAP account; you can still sign in with the email link, or ask us to delete the account (see Section 8).")}
      </P>

      <H3>{t("privacy.information.automaticHeading", "2.3 Information collected automatically")}</H3>
      <UL>
        <li><strong>{t("privacy.information.automatic.activityTitle", "Activity data:")}</strong> {t("privacy.information.automatic.activityText", "pages, markets, vendors and reports you view, filters and searches you use, AI chat prompts, RFPs you build, time spent and interactions.")}</li>
        <li><strong>{t("privacy.information.automatic.trafficTitle", "Traffic and device data:")}</strong> {t("privacy.information.automatic.trafficText", "random first-party visitor and session identifiers, page path, referring page, campaign (UTM) parameters, browser user agent, IP address and the approximate country, region and city derived from it.")}</li>
        <li><strong>{t("privacy.information.automatic.signInHistoryTitle", "Sign-in history:")}</strong> {t("privacy.information.automatic.signInHistoryText", "when you signed in, which method you used (email link or Google) and the number of sessions used before your email was verified.")}</li>
      </UL>
      <P>
        {t("privacy.information.noFingerprinting", "We do not use browser fingerprinting, request GPS location, or trust a browser-supplied IP address or location.")}
      </P>

      <H2>{t("privacy.cookies.heading", "3. Cookies and similar technologies")}</H2>
      <UL>
        <li><strong>{t("privacy.cookies.sessionTitle", "Session cookie")}</strong> {t("privacy.cookies.sessionText", "(HTTP-only, secure): keeps you signed in. Deleted when you sign out or the session expires.")}</li>
        <li><strong>{t("privacy.cookies.visitorTitle", "Visitor cookie")}</strong> {t("privacy.cookies.visitorText", "(HTTP-only): a random identifier that recognises the same browser over time so that traffic statistics are not double-counted, and so that a browser's earlier visits can be associated with your account once you sign in.")}</li>
        <li><strong>{t("privacy.cookies.trafficSessionTitle", "Traffic-session cookie")}</strong> {t("privacy.cookies.trafficSessionText", "(HTTP-only): expires after 30 minutes of inactivity; groups page views into one visit.")}</li>
        <li><strong>{t("privacy.cookies.browserStorageTitle", "Browser storage:")}</strong> {t("privacy.cookies.browserStorageText", "we use local and session storage for preferences such as dismissed notices, the free-preview timer for anonymous visitors, and your acceptance of the Terms. These values never leave your browser except as described in Section 5.")}</li>
        <li><strong>{t("privacy.cookies.advertisingTitle", "Advertising measurement:")}</strong> {t("privacy.cookies.advertisingText", "pages include the Reddit conversion pixel, which sets Reddit's own cookies and reports page visits and sign-ups to Reddit so that we can measure the effectiveness of our advertising. See Section 5.")}</li>
      </UL>
      <P>
        {t("privacy.cookies.blocking", "You can block or delete cookies in your browser settings. Blocking the session cookie will prevent you from staying signed in.")}
      </P>

      <H2>{t("privacy.use.heading", "4. How we use information")}</H2>
      <UL>
        <li>{t("privacy.use.items.account", "Create and administer your account, authenticate you (by email link or Google) and keep your account secure.")}</li>
        <li>{t("privacy.use.items.emails", "Send transactional emails: sign-in and email-verification links, company-email verification links and service notices. We do not send marketing newsletters without a separate opt-in.")}</li>
        <li>{t("privacy.use.items.service", "Provide the Service: market landscapes, vendor scores, comparisons, reports, news, intelligence feeds, security intelligence, RFP tools and AI chat.")}</li>
        <li>{t("privacy.use.items.access", "Apply access rules, for example unlocking research reports, news and the intelligence feed once a company email has been verified.")}</li>
        <li>{t("privacy.use.items.measure", "Measure traffic, geographic demand and market interest; troubleshoot, secure and improve the Service.")}</li>
        <li>{t("privacy.use.items.vendors", "Provide vendors with the market-interest and lead information described in Section 5 and in the Terms.")}</li>
        <li>{t("privacy.use.items.legal", "Comply with legal obligations and enforce our Terms.")}</li>
      </UL>
      <P>
        {t("privacy.use.legalBasis", "Where the GDPR or similar laws apply, we rely on: performance of a contract (providing the Service you signed up for), our legitimate interests (security, analytics, product improvement, business-to-business marketing), your consent (Google sign-in, sharing with vendors, advertising measurement) and compliance with law.")}
      </P>

      <H2>{t("privacy.sharing.heading", "5. How we share information")}</H2>
      <UL>
        <li><strong>{t("privacy.sharing.googleTitle", "Google LLC.")}</strong> {t("privacy.sharing.googleBeforeLink", "When you choose Sign in with Google, Google processes the sign-in under the")}{" "}<A href="https://policies.google.com/privacy">{t("privacy.sharing.googleLink", "Google Privacy Policy")}</A>{t("privacy.sharing.googleAfterLink", ". We do not send your ITMAP activity to Google.")}</li>
        <li><strong>{t("privacy.sharing.providersTitle", "Service providers")}</strong> {t("privacy.sharing.providersText", "acting on our instructions: cloud hosting and database (Replit), transactional email delivery (Resend), IP-to-location lookup (ipwho.is receives the IP address only), AI model providers that process the text of your AI chat prompts and our content pipelines, and error and performance monitoring.")}</li>
        <li><strong>{t("privacy.sharing.redditTitle", "Reddit, Inc.")}</strong> {t("privacy.sharing.redditText", "for advertising measurement: page visits and account sign-ups are reported through the Reddit pixel and, for sign-ups, a server-side conversion event containing a hashed email address, IP address, user agent and a random event identifier. We do not share your name, company or on-site activity with Reddit.")}</li>
        <li><strong>{t("privacy.sharing.legalTitle", "Legal and safety:")}</strong> {t("privacy.sharing.legalText", "where required by law, regulation, legal process or to protect the rights, property or safety of ITMAP, our users or others.")}</li>
        <li><strong>{t("privacy.sharing.transfersTitle", "Business transfers:")}</strong> {t("privacy.sharing.transfersText", "in connection with a merger, acquisition, financing or sale of assets, subject to this Policy.")}</li>
      </UL>
      <P>{t("privacy.sharing.noSale", "We do not sell personal data and we do not share Google user data with third parties except as necessary to provide the sign-in feature itself.")}</P>

      <H2>{t("privacy.retention.heading", "6. Data retention")}</H2>
      <UL>
        <li>{t("privacy.retention.account", "Account and profile data are kept for as long as your account exists, then deleted or anonymised within 90 days of a deletion request, except where we must retain records by law.")}</li>
        <li>{t("privacy.retention.tokens", "Verification tokens for sign-in and company-email links are single-use and are cleared as soon as they are used or replaced.")}</li>
        <li>{t("privacy.retention.traffic", "Traffic records, including IP addresses, are retained indefinitely for trend analysis unless deletion is required by applicable law or you request it.")}</li>
        <li>{t("privacy.retention.content", "Content you create (RFPs, comparisons, chat history) is kept until you delete it or your account is deleted.")}</li>
      </UL>

      <H2>{t("privacy.security.heading", "7. Security")}</H2>
      <P>
        {t("privacy.security.description", "All traffic to ITMAP is encrypted with TLS. Sign-in is passwordless: we rely on single-use emailed links and on Google's authentication rather than storing user passwords. Verification tokens are random, single-use and stored so that they cannot be read from any user-facing interface. Detailed traffic intelligence and account administration are restricted to authorised ITMAP administrators. No method of transmission or storage is completely secure; please contact us immediately if you believe your account has been compromised.")}
      </P>

      <H2>{t("privacy.rights.heading", "8. Your rights and choices")}</H2>
      <UL>
        <li><strong>{t("privacy.rights.accessTitle", "Access, correction and portability:")}</strong> {t("privacy.rights.accessText", "you can view and edit your name and company profile on your Profile page and request a copy of your data by email.")}</li>
        <li><strong>{t("privacy.rights.deletionTitle", "Deletion:")}</strong> {t("privacy.rights.deletionBeforeEmail", "email")}{" "}<A href="mailto:privacy@itmap.ai">{t("privacy.rights.email", "privacy@itmap.ai")}</A>{t("privacy.rights.deletionAfterEmail", " from your account address to delete your account and associated personal data.")}</li>
        <li><strong>{t("privacy.rights.googleTitle", "Google sign-in:")}</strong> {t("privacy.rights.googleBeforeLink", "revoke ITMAP's access at")}{" "}<A href="https://myaccount.google.com/permissions">{t("privacy.rights.permissionsLink", "myaccount.google.com/permissions")}</A>{t("privacy.rights.googleAfterLink", ". You can also ask us to unlink Google from your account so that only email-link sign-in remains.")}</li>
        <li><strong>{t("privacy.rights.vendorTitle", "Vendor sharing:")}</strong> {t("privacy.rights.vendorText", "withdraw consent to sharing with vendors at any time by email; withdrawal does not affect data already shared.")}</li>
        <li><strong>{t("privacy.rights.objectionTitle", "Objection and restriction:")}</strong> {t("privacy.rights.objectionText", "where local law provides, you may object to or restrict certain processing, and you may lodge a complaint with your data-protection authority.")}</li>
      </UL>
      <P>{t("privacy.rights.response", "We respond to verified requests within 30 days. Available rights vary by jurisdiction.")}</P>

      <H2>{t("privacy.transfers.heading", "9. International transfers")}</H2>
      <P>
        {t("privacy.transfers.description", "ITMAP is operated from the United Arab Emirates and our service providers process data in the United States and other countries. Where required, we rely on contractual safeguards such as standard contractual clauses for those transfers.")}
      </P>

      <H2>{t("privacy.children.heading", "10. Children")}</H2>
      <P>
        {t("privacy.children.description", "The Service is intended for business users and is not directed to anyone under 18. We do not knowingly collect personal data from children; if you believe a child has provided us data, contact us and we will delete it.")}
      </P>

      <H2>{t("privacy.changes.heading", "11. Changes to this Policy")}</H2>
      <P>
        {t("privacy.changes.description", 'We may update this Policy from time to time. The "Last updated" date at the top shows the current version. Material changes will be announced by email or an in-app notice before they take effect.')}
      </P>

      <H2>{t("privacy.contact.heading", "12. Contact us")}</H2>
      <P>
        {t("privacy.contact.privacyLabel", "Privacy questions and requests:")}{" "}<A href="mailto:privacy@itmap.ai">{t("privacy.contact.privacyEmail", "privacy@itmap.ai")}</A>
        {t("privacy.contact.generalLabel", ". General enquiries:")}{" "}<A href="/contact">{t("privacy.contact.contactLink", "itmap.ai/contact")}</A>.
      </P>

    </>
  );
}
