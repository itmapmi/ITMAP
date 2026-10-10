// Email-verification policy for passwordless self-registered accounts.
//
// An unverified account is allowed this many *independent sessions* (each
// register / login that mints a new server session counts as one; a session
// simply being restored from its cookie does not). Sign-ins beyond this
// number are refused until the emailed verification link has been clicked.
//
// Shared so the server (enforcement) and client (banner / reminder copy)
// can never drift apart.
import { hasCampaignBuyerAccess, type CampaignBuyerState } from "./campaign-access";
export const MAX_UNVERIFIED_SESSIONS = 3;

type VerificationState = CampaignBuyerState & {
  emailVerified: boolean;
  unverifiedSessionCount: number | null;
};

// Whether an unverified account may be granted ONE MORE independent session
// (checked before the counter is incremented at login/register).
export function canStartUnverifiedSession(user: VerificationState): boolean {
  if (user.emailVerified || hasCampaignBuyerAccess(user)) return true;
  return (user.unverifiedSessionCount ?? 0) < MAX_UNVERIFIED_SESSIONS;
}

// Whether an already-issued session may keep working (checked on every
// request, after the counter has been incremented for that session).
export function hasUnverifiedSessionAllowance(user: VerificationState): boolean {
  if (user.emailVerified || hasCampaignBuyerAccess(user)) return true;
  return (user.unverifiedSessionCount ?? 0) <= MAX_UNVERIFIED_SESSIONS;
}

// Sessions still available to an unverified account, for UI copy.
export function unverifiedSessionsRemaining(user: VerificationState): number {
  return Math.max(0, MAX_UNVERIFIED_SESSIONS - (user.unverifiedSessionCount ?? 0));
}
