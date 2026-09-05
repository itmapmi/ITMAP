import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { apiRequestJson } from "@/lib/queryClient";
import type { User, LoginUser, RegisterUser } from "@shared/schema";
import { hasFeatureAccess, type LockableFeatureKey } from "@shared/features";
import { getRedditClickId, getRedditUuid, trackRedditSignUp } from "@/lib/reddit-pixel";
import {
  GOOGLE_RETURN_PARAM,
  GOOGLE_RETURN_VALUE,
  GOOGLE_SIGNUP_EVENT_PATH,
} from "@/components/google-sign-in-button";

// Passwordless signup: a brand-new account may sign in for a limited number
// of independent sessions (MAX_UNVERIFIED_SESSIONS in shared/verification.ts)
// before it must be verified. The server enforces this at login and on every
// request, but once a session is refused or has ended `/api/auth/user` looks
// identical to "never signed up" — there is no session left to read
// `emailVerified` / the session counter off of. This localStorage marker is
// purely a client-side memory of "someone signed up with this email and
// needs to verify it" (plus how many sessions they have used, and whether
// the server has already refused them), so the UI can show a specific
// "verify your email" screen instead of the generic logged-out state.
export const PENDING_VERIFICATION_KEY = "itmap_pending_verification";
// Fired on `window` whenever the marker changes so hooks can react at once
// instead of waiting for their next poll.
export const PENDING_VERIFICATION_EVENT = "itmap:pending-verification-changed";

export interface PendingVerification {
  email: string;
  createdAt: string;
  /** Independent sessions this account has used while unverified (last known). */
  sessionsUsed?: number;
  /** True once the server has refused a sign-in with `verification_required`. */
  verificationRequired?: boolean;
}

export function getPendingVerification(): PendingVerification | null {
  try {
    const raw = localStorage.getItem(PENDING_VERIFICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.email === "string" && typeof parsed?.createdAt === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function setPendingVerification(value: PendingVerification | null) {
  try {
    if (value) localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch {
    // Storage can be unavailable (private browsing, quota) — non-critical.
  }
  try {
    window.dispatchEvent(new Event(PENDING_VERIFICATION_EVENT));
  } catch {
    // SSR / non-browser — nothing to notify.
  }
}

function syncPendingVerificationFromUser(user: any) {
  if (!user) return;
  if (user.emailVerified === false && user.email && user.createdAt) {
    setPendingVerification({
      email: user.email,
      createdAt: user.createdAt,
      sessionsUsed: typeof user.unverifiedSessionCount === "number" ? user.unverifiedSessionCount : undefined,
    });
  } else if (user.emailVerified === true) {
    setPendingVerification(null);
  }
}

// Thrown by login/register when the server blocks access pending email
// verification, so the UI can show the specific "verify your email" flow
// instead of a generic error message.
export class VerificationRequiredError extends Error {
  email: string;
  constructor(message: string, email: string) {
    super(message);
    this.name = "VerificationRequiredError";
    this.email = email;
  }
}

// Thrown by login when the account (currently: admin accounts that have set
// a password) needs a password that wasn't included in the request yet, so
// the UI can reveal the password field instead of showing a generic error.
export class PasswordRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRequiredError";
  }
}

// Posts to an auth endpoint (login/register) and surfaces a structured
// VerificationRequiredError/PasswordRequiredError instead of a generic
// "403: {...}" message when the server reports one of those conditions.
async function postAuth(url: string, data: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error === "verification_required") {
      const previous = getPendingVerification();
      const sameAccount = previous !== null && previous.email === body.email;
      setPendingVerification({
        email: body.email,
        createdAt: sameAccount ? previous.createdAt : new Date().toISOString(),
        sessionsUsed: sameAccount ? previous.sessionsUsed : undefined,
        verificationRequired: true,
      });
      throw new VerificationRequiredError(body.message || "Please verify your email to continue.", body.email);
    }
    if (body?.error === "password_required") {
      throw new PasswordRequiredError(body.message || "Enter your password to continue.");
    }
    throw new Error(body?.error || body?.message || `${res.status}: request failed`);
  }
  return body;
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    throwOnError: false,
    retryOnMount: false,
    refetchOnMount: false,
  });

  // Keep the client-only "pending verification" marker honest whenever the
  // session user changes for any reason (initial load, refetch after
  // clicking the emailed link, etc.) — not just right after a login/register
  // mutation. Otherwise a stale marker could outlive an account that has
  // since been verified.
  useEffect(() => {
    syncPendingVerificationFromUser(user);
  }, [user]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginUser) => postAuth('/auth/login', credentials),
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      syncPendingVerificationFromUser(user);
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequestJson('/auth/resend-verification', 'POST', { email });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: RegisterUser) => {
      // Forward Reddit Ads match keys (if present) so the server can pair
      // this signup with a Conversions API event for the same conversion.
      const redditClickId = getRedditClickId();
      const redditUuid = getRedditUuid();
      return postAuth('/auth/register', {
        ...userData,
        ...(redditClickId ? { redditClickId } : {}),
        ...(redditUuid ? { redditUuid } : {}),
      });
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      syncPendingVerificationFromUser(user);
      // Same conversionId the server sends with its Conversions API SignUp
      // event (the user's own id) — Reddit's documented way to tie a Pixel
      // event and a CAPI event to the same conversion.
      trackRedditSignUp((user as { id?: string })?.id ?? null);
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword?: string; newPassword: string }) =>
      apiRequestJson('/api/account/set-password', 'POST', data),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequestJson('/auth/logout', 'POST');
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setPendingVerification(null);
    },
  });

  const isVendorScoped = !!(user?.vendorScopeId || (user as any)?.vendorScopeIds?.length);
  const isVendorPersona = (user as any)?.persona === "vendor";

  return {
    user,
    isLoading,
    // Only `user` decides this: with refetchOnMount/refetchOnWindowFocus/
    // refetchInterval all off, `error` only reflects a *stale* failure from
    // a previous fetch (e.g. login), not a live one — it must never flip an
    // otherwise-valid cached session to "logged out" mid-render.
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isBuyer: !!user && !isVendorScoped && !isVendorPersona && user.role !== 'admin',
    vendorScopeId: user?.vendorScopeId ?? null,
    isVendorScoped,
    isVendorPersona,
    // Buyers get all features unlocked; vendor users (scoped or persona) are gated
    hasFeature: (featureKey: LockableFeatureKey) =>
      hasFeatureAccess(user?.role, user?.featureAccess, featureKey, isVendorScoped, isVendorPersona),
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    resendVerification: resendVerificationMutation.mutateAsync,
    isResendingVerification: resendVerificationMutation.isPending,
    resendVerificationError: resendVerificationMutation.error?.message,
    loginError: loginMutation.error?.message,
    registerError: registerMutation.error?.message,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    setPassword: setPasswordMutation.mutateAsync,
    isSettingPassword: setPasswordMutation.isPending,
    setPasswordError: setPasswordMutation.error?.message,
  };
}
// Landing back from "Continue with Google". The server has already minted
// the session and 302'd to the page the user started on with `?auth=google`;
// this hook (mounted once, app-wide) tidies up:
//   - strips the flag from the URL so a refresh cannot replay it;
//   - drops any stale "verify your email" marker — a Google-authenticated
//     address is verified, so the session-count block no longer applies;
//   - refreshes the session user;
//   - asks the server (single-use, bound to the new session) whether this
//     sign-in created a brand-new account, and if so fires the client-side
//     Reddit SignUp pixel once with the server-supplied conversionId (the
//     same id the server's Conversions API event carried). A returning
//     sign-in, a refresh, or a hand-typed `?auth=google` never tracks.
export function useGoogleSignInReturn() {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || typeof window === "undefined") return;
    handled.current = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get(GOOGLE_RETURN_PARAM) !== GOOGLE_RETURN_VALUE) return;
    url.searchParams.delete(GOOGLE_RETURN_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    setPendingVerification(null);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

    apiRequestJson(GOOGLE_SIGNUP_EVENT_PATH, "POST")
      .then((body: { conversionId?: string | null } | null) => {
        if (body?.conversionId) trackRedditSignUp(body.conversionId);
      })
      .catch(() => {
        // Tracking is best-effort; the sign-in itself already succeeded.
      });
  }, []);
}
