// Company-email profile gate.
//
// Sign-up accepts any address (a personal email typed into the form, or a
// Google account). Buyers whose *login* email is on a consumer domain are
// asked to complete a short profile — company name, company email,
// designation — and verify the company email before Reports, News and the
// Intelligence Feed unlock. Access stays free and the login email is never
// changed; the verified company email is a separate field on the account.
//
// Shared so the server (enforcement in requireFeature) and the client
// (lock icons / tooltips / CTA) can never disagree about who is gated.

import type { LockableFeatureKey } from "./features";

// Free / consumer mailbox providers. A login email on one of these domains
// tells us nothing about the buyer's organisation, hence the profile gate.
export const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "ymail.com", "yahoo.co.uk", "yahoo.co.in", "yahoo.fr", "yahoo.de", "yahoo.ca", "yahoo.com.au",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me", "pm.me",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  "yandex.com", "yandex.ru", "mail.ru", "gmx.com", "gmx.net", "gmx.de", "zoho.com",
  "rediffmail.com", "mail.com", "email.com", "hey.com", "fastmail.com", "tutanota.com",
]);

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

export function isConsumerEmailDomain(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  return !!domain && CONSUMER_EMAIL_DOMAINS.has(domain);
}

// Features that stay locked until the company email is verified.
export const COMPANY_EMAIL_GATED_FEATURES: readonly LockableFeatureKey[] = [
  "research_reports",
  "news",
  "intelligence_feed",
] as const;

export function isCompanyEmailGatedFeature(key: LockableFeatureKey): boolean {
  return (COMPANY_EMAIL_GATED_FEATURES as readonly string[]).includes(key);
}

// Machine-readable reason returned (HTTP 403) by the gated APIs. The client
// matches on this string to show the "complete your profile" CTA instead of
// a generic error.
export const COMPANY_EMAIL_REQUIRED = "company_email_required";

// Copy shared by every lock surface (tooltips, panels, mobile sheets).
export const COMPANY_PROFILE_LOCK_MESSAGE =
  "Complete your short profile to unlock — it's free";
export const COMPANY_PROFILE_PATH = "/me/profile";

type CompanyGateUser = {
  role?: string | null;
  persona?: string | null;
  vendorScopeId?: string | null;
  vendorScopeIds?: string[] | null;
  email?: string | null;
  companyEmailVerified?: boolean | null;
};

// Whether this account must verify a company email before the gated
// features open up. Admins and vendor users (scoped seat or vendor persona)
// are never gated; neither is anyone whose login email is already on a
// business domain, nor anyone who has already verified a company email.
export function needsCompanyEmailVerification(user: CompanyGateUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return false;
  if (user.persona === "vendor") return false;
  if (user.vendorScopeId || (user.vendorScopeIds && user.vendorScopeIds.length > 0)) return false;
  if (user.companyEmailVerified) return false;
  return isConsumerEmailDomain(user.email);
}
