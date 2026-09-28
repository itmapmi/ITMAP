import React from "react";
import { makeLegalPrimitives, type RenderLink, PRIVACY_POLICY_PATH } from "./primitives";

// Terms of Service body — shared by the React page (client) and the server-rendered
// HTML at /termsofservice. See ./primitives.tsx for why this must stay free of hooks,
// router imports and browser globals.

export const TERMS_OF_SERVICE_META = {
  title: "Terms of Service — ITMAP.ai",
  heading: "ITMAP.ai — Terms of Service",
  description:
    "ITMAP.ai Terms of Service, covering accounts, Sign in with Google, AI-generated content, vendor data sharing and acceptable use.",
};

export function TermsOfServiceBody({
  renderLink,
  t = (_key, defaultValue) => defaultValue,
}: {
  renderLink?: RenderLink;
  t?: (key: string, defaultValue: string) => string;
} = {}) {
  const { H2, P, UL, A } = makeLegalPrimitives(renderLink);
  return (
    <>

      <P>
        {t("terms.intro.agreementBeforeSite", 'These Terms of Service ("Terms") are a binding agreement between you and ITMAP.ai ("ITMAP", "we", "us") governing your use of')}
        {" "}<A href="https://itmap.ai">{t("terms.intro.siteName", "itmap.ai")}</A>{" "}
        {t("terms.intro.agreementAfterSite", "and the related services, content and tools (the \"Service\"). By creating an account — whether by entering your email address or by clicking")}
        {" "}<strong>{t("terms.intro.googleButton", "Continue with Google")}</strong>
        {" "}{t("terms.intro.agreementAfterGoogle", "— or by using the Service, you accept these Terms and our")}
        {" "}<A href={PRIVACY_POLICY_PATH}>{t("terms.intro.privacyPolicyLink", "Privacy Policy")}</A>
        {t("terms.intro.agreementEnd", ". If you do not agree, do not use the Service.")}
      </P>
      <P>
        {t("terms.intro.companyUse", 'If you use the Service on behalf of a company, you represent that you are authorised to bind that company to these Terms, and "you" includes that company.')}
      </P>

      <H2>{t("terms.service.heading", "1. The Service")}</H2>
      <P>
        {t("terms.service.descriptionBeforeFree", "ITMAP.ai provides AI-generated enterprise IT market intelligence, including vendor landscapes, product comparisons, vendor scores, research reports, news and intelligence feeds, security intelligence, RFP generation, AI chat and related tools. The Service is currently provided")}
        {" "}<strong>{t("terms.service.freeOfCharge", "free of charge")}</strong>
        {" "}{t("terms.service.descriptionAfterFree", "to end users. We may add, modify, gate or discontinue any feature at any time.")}
      </P>

      <H2>{t("terms.eligibility.heading", "2. Eligibility")}</H2>
      <P>
        {t("terms.eligibility.description", "The Service is intended for business use. You must be at least 18 years old and able to form a binding contract. You may not use the Service if you are barred from doing so under applicable law.")}
      </P>

      <H2>{t("terms.accounts.heading", "3. Accounts and sign-in")}</H2>
      <UL>
        <li><strong>{t("terms.accounts.passwordlessTitle", "Passwordless sign-in.")}</strong> {t("terms.accounts.passwordlessText", "ITMAP does not use passwords. You sign in either with a single-use link sent to your email address or through Sign in with Google. You are responsible for keeping your email account and Google Account secure; anyone with access to them can access your ITMAP account.")}</li>
        <li><strong>{t("terms.accounts.emailVerificationTitle", "Email verification.")}</strong> {t("terms.accounts.emailVerificationText", "When you register with an email address we send a verification link. You may use the Service for a limited number of sessions before verifying; after that, verification is required to continue.")}</li>
        <li><strong>{t("terms.accounts.signInEmailTitle", "Sign-in email.")}</strong> {t("terms.accounts.signInEmailText", "The email address you register with (or the address of the Google Account you sign in with) is your account identity and cannot be changed from within the Service. Contact us if you need to move your account to a different address.")}</li>
        <li><strong>{t("terms.accounts.companyProfileTitle", "Company profile.")}</strong> {t("terms.accounts.companyProfileText", "Accounts registered with a personal email provider (for example Gmail, Yahoo or Outlook) can access most of the Service immediately. Research reports, news and the intelligence feed are unlocked, free of charge, once you complete a short company profile and verify a work email address by clicking the link we send to it. A work email address may be verified on one account only. Your sign-in email does not change.")}</li>
        <li><strong>{t("terms.accounts.accurateInformationTitle", "Accurate information.")}</strong> {t("terms.accounts.accurateInformationText", "You agree to provide accurate, current information, including your name, company name, job designation and business email, and to keep it up to date.")}</li>
        <li><strong>{t("terms.accounts.onePersonTitle", "One person per account.")}</strong> {t("terms.accounts.onePersonText", "Accounts are personal and may not be shared. You are responsible for all activity under your account.")}</li>
      </UL>

      <H2>{t("terms.google.heading", "4. Sign in with Google")}</H2>
      <P>
        {t("terms.google.intro", "If you choose to register or sign in with your Google Account:")}
      </P>
      <UL>
        <li>{t("terms.google.items.authoriseBeforeLink", "You authorise Google to share with ITMAP your Google Account email address, its verification status, your name, your profile picture and a unique account identifier, as described in our")}{" "}<A href={PRIVACY_POLICY_PATH}>{t("terms.google.privacyPolicyLink", "Privacy Policy")}</A>{t("terms.google.items.authoriseAfterLink", ". We request no other Google data and cannot access your Gmail, Contacts, Drive or other Google services.")}</li>
        <li>{t("terms.google.items.useInformation", "We use this information solely to create and secure your ITMAP account, sign you in, pre-fill your profile and link it with any existing ITMAP account that has the same verified email address.")}</li>
        <li>{t("terms.google.items.apiPolicyBeforeLink", "ITMAP's use of information received from Google APIs adheres to the")}{" "}<A href="https://developers.google.com/terms/api-services-user-data-policy">{t("terms.google.apiPolicyLink", "Google API Services User Data Policy")}</A>{t("terms.google.items.apiPolicyAfterLink", ", including its Limited Use requirements.")}</li>
        <li>{t("terms.google.items.googleTerms", "Your use of Google is governed by Google's own terms and privacy policy. ITMAP is not responsible for Google's services, and Google is not a party to these Terms.")}</li>
        <li>{t("terms.google.items.revokeBeforeLink", "You may revoke ITMAP's access at any time at")}{" "}<A href="https://myaccount.google.com/permissions">{t("terms.google.permissionsLink", "myaccount.google.com/permissions")}</A>{t("terms.google.items.revokeAfterLink", ". Revoking access does not delete your ITMAP account; you can continue to sign in with the email link or ask us to delete the account.")}</li>
        <li>{t("terms.google.items.unverifiedEmail", "If Google reports your email address as unverified, we will not create or link an account with it.")}</li>
      </UL>

      <H2>{t("terms.ai.heading", "5. AI-generated content — no warranty")}</H2>
      <P>
        {t("terms.ai.contentBeforeEmphasis", "Content on ITMAP.ai — including vendor scores, landscape placements, comparisons, forecasts, report summaries, news classification, security intelligence and AI chat answers — is")}{" "}
        <strong>{t("terms.ai.generated", "generated and updated by automated AI systems")}</strong>{" "}
        {t("terms.ai.contentBeforeDisclaimer", "using publicly available information and vendor-submitted material. It is provided")}{" "}
        <strong>{t("terms.ai.disclaimer", '"as is", for informational purposes only')}</strong>{t("terms.ai.contentAfterDisclaimer", ", and may contain errors, omissions or outdated information.")}
      </P>
      <UL>
        <li>{t("terms.ai.items.notAdviceBefore", "ITMAP.ai content is")}{" "}<strong>{t("terms.ai.items.notAdvice", "not professional, financial, legal, security or purchasing advice")}</strong>.</li>
        <li>{t("terms.ai.items.verify", "You are solely responsible for independently verifying information before making any purchasing, investment, security or business decision.")}</li>
        <li>{t("terms.ai.items.placements", "Vendor placements and scores are not endorsements and are not influenced by payment from vendors.")}</li>
        <li>{t("terms.ai.items.warranties", "We make no warranties of accuracy, completeness, fitness for a particular purpose, non-infringement or merchantability.")}</li>
      </UL>

      <H2>{t("terms.data.heading", "6. Data we collect and how we use it")}</H2>
      <P>
        {t("terms.data.descriptionBeforeLink", "We collect account data (name, company name, designation, sign-in email and company email), information received from Google when you use Sign in with Google, activity data (markets, reports and vendors you view, searches, AI chat prompts, RFPs and comparisons) and traffic and device data (random first-party visitor and session identifiers, page paths, referring page, campaign parameters, browser user agent, IP address and approximate location derived from it). Collection begins when a page loads, including for anonymous visitors. We use this data to operate, secure, analyse and improve the Service, to send transactional emails, to apply access rules, for advertising measurement and for the purposes in Section 7. Full details, retention periods and your rights are in our")}{" "}<A href={PRIVACY_POLICY_PATH}>{t("terms.data.privacyPolicyLink", "Privacy Policy")}</A>{t("terms.data.descriptionAfterLink", ", which forms part of these Terms.")}
      </P>

      <H2>{t("terms.sharing.heading", "7. Sharing your data with vendors — please read")}</H2>
      <P>
        <strong>{t("terms.sharing.consent", "By agreeing to these Terms, you consent to ITMAP.ai sharing your name, company name, job designation and business email address with technology vendors whose markets or products you engage with on the platform.")}</strong>{" "}{t("terms.sharing.descriptionAfterConsent", "Vendors may contact you regarding their products and services. We do not sell your browsing history, but vendors may be informed of your general interest in a market category.")}
      </P>
      <P>
        {t("terms.sharing.withdrawBeforeLink", "You may withdraw this consent at any time by emailing")}{" "}<A href="mailto:privacy@itmap.ai">{t("terms.sharing.emailLink", "privacy@itmap.ai")}</A>
        {t("terms.sharing.withdrawAfterLink", ". Withdrawal does not affect data already shared. Information received from Google is never shared with vendors beyond the name and email address that also form part of your ITMAP account data.")}
      </P>

      <H2>{t("terms.acceptableUse.heading", "8. Acceptable use")}</H2>
      <P>{t("terms.acceptableUse.intro", "You agree not to:")}</P>
      <UL>
        <li>{t("terms.acceptableUse.items.scrape", "scrape, crawl, bulk-download, resell, sublicense or redistribute ITMAP content or data, or use it to train machine-learning models, without our written permission;")}</li>
        <li>{t("terms.acceptableUse.items.reverseEngineer", "reverse-engineer, probe or interfere with the Service, its security or its access controls, or circumvent feature gates such as email or company-email verification;")}</li>
        <li>{t("terms.acceptableUse.items.impersonate", "register with an email address you do not control, impersonate any person or company, or create accounts on behalf of others without authority;")}</li>
        <li>{t("terms.acceptableUse.items.submit", "submit false, misleading or infringing vendor information, reviews or fact-review responses;")}</li>
        <li>{t("terms.acceptableUse.items.unlawful", "use the Service for any unlawful purpose or in breach of export-control or sanctions laws.")}</li>
      </UL>

      <H2>{t("terms.vendorAccounts.heading", "9. Vendor accounts")}</H2>
      <P>
        {t("terms.vendorAccounts.description", "If you access the Service as a vendor representative, you warrant that you are authorised by that vendor, that information you submit is accurate and non-infringing, and you grant ITMAP a worldwide, royalty-free licence to use, display and analyse that information within the Service. Vendor access to buyer information is limited to what these Terms and the Privacy Policy allow.")}
      </P>

      <H2>{t("terms.intellectualProperty.heading", "10. Intellectual property")}</H2>
      <P>
        {t("terms.intellectualProperty.description", "The Service, its content, scores, models, reports and trademarks are owned by ITMAP.ai or its licensors. We grant you a limited, revocable, non-exclusive, non-transferable licence to use the Service and to use content you legitimately access for your internal business purposes. Content you create (for example RFPs) remains yours; you grant us a licence to host and process it to provide the Service.")}
      </P>

      <H2>{t("terms.thirdParty.heading", "11. Third-party services")}</H2>
      <P>
        {t("terms.thirdParty.description", "The Service relies on third parties including Google (sign-in), email delivery providers, cloud hosting and AI model providers, and may link to external websites. We are not responsible for third-party services or content, and your use of them is subject to their own terms.")}
      </P>

      <H2>{t("terms.warranties.heading", "12. Disclaimer of warranties")}</H2>
      <P>
        {t("terms.warranties.description", 'The Service is provided "as is" and "as available". To the maximum extent permitted by law we disclaim all warranties, express or implied, including uninterrupted or error-free operation and the accuracy of any content.')}
      </P>

      <H2>{t("terms.liability.heading", "13. Limitation of liability")}</H2>
      <P>
        {t("terms.liability.descriptionBeforeLimit", "To the maximum extent permitted by law, ITMAP.ai and its affiliates, officers, employees and partners shall not be liable for any indirect, incidental, consequential, special or punitive damages, or for any loss of profits, revenue, data or business opportunity, arising from your use of (or inability to use) the Service or reliance on its content. Our total aggregate liability for any claim shall not exceed")}{" "}<strong>{t("terms.liability.limit", "USD 100")}</strong>.
      </P>

      <H2>{t("terms.indemnification.heading", "14. Indemnification")}</H2>
      <P>
        {t("terms.indemnification.description", "You agree to indemnify and hold harmless ITMAP.ai from claims, losses and expenses (including reasonable legal fees) arising out of your misuse of the Service, content you submit or your violation of these Terms.")}
      </P>

      <H2>{t("terms.termination.heading", "15. Suspension and termination")}</H2>
      <P>
        {t("terms.termination.descriptionBeforeLink", "We may suspend or terminate your account at any time for violation of these Terms or to protect the Service. You may stop using the Service at any time and may request deletion of your account by emailing")}{" "}
        <A href="mailto:privacy@itmap.ai">{t("terms.termination.emailLink", "privacy@itmap.ai")}</A>{t("terms.termination.descriptionAfterLink", ". Sections 5, 7 (as to data already shared), 10 and 12–17 survive termination.")}
      </P>

      <H2>{t("terms.changes.heading", "16. Changes to these Terms")}</H2>
      <P>
        {t("terms.changes.description", "We may update these Terms from time to time. Material changes will be notified by email or an in-app notice before they take effect. Continued use after changes constitutes acceptance.")}
      </P>

      <H2>{t("terms.governingLaw.heading", "17. Governing law and disputes")}</H2>
      <P>
        {t("terms.governingLaw.beforeJurisdiction", "These Terms are governed by the laws of the")}{" "}<strong>{t("terms.governingLaw.jurisdiction", "United Arab Emirates")}</strong>{t("terms.governingLaw.afterJurisdiction", ", and disputes shall be resolved exclusively in the courts of that jurisdiction, without prejudice to any mandatory consumer rights you may have under the laws of your country of residence.")}
      </P>

      <H2>{t("terms.contact.heading", "18. Contact")}</H2>
      <P>
        {t("terms.contact.legalQuestions", "Legal questions:")}{" "}<A href="mailto:legal@itmap.ai">{t("terms.contact.legalEmail", "legal@itmap.ai")}</A>{t("terms.contact.privacyRequests", ". Privacy requests:")}{" "}
        <A href="mailto:privacy@itmap.ai">{t("terms.contact.privacyEmail", "privacy@itmap.ai")}</A>.
      </P>

    </>
  );
}
