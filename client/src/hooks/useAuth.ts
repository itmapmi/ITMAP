import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { apiRequestJson } from "@/lib/queryClient";
import type { User, LoginUser, RegisterUser } from "@shared/schema";
import { hasFeatureAccess, type LockableFeatureKey } from "@shared/features";
import { getRedditClickId, getRedditUuid, trackRedditSignUp } from "@/lib/reddit-pixel";

// Passwordless signup: a brand-new account gets a short grace period (see
// GRACE_MS in email-verification-gate.tsx / EMAIL_VERIFICATION_GRACE_MS on
// the server) to browse before it must be verified. The server enforces this
// on every
// request (the session itself stops working past the deadline), but once
// that happens `/api/auth/user` looks identical to "never signed up" —
// there is no session left to read `createdAt`/`emailVerified` off of. This
// localStorage marker is purely a client-side memory of "someone signed up
// with this email and needs to verify it", so the UI can show a specific
// "verify your email" screen instead of the generic logged-out state.
export const PENDING_VERIFICATION_KEY = "itmap_pending_verification";

export interface PendingVerification {
  email: string;
  createdAt: string;
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
}

function syncPendingVerificationFromUser(user: any) {
  if (!user) return;
  if (user.emailVerified === false && user.email && user.createdAt) {
    setPendingVerification({ email: user.email, createdAt: user.createdAt });
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
      setPendingVerification({ email: body.email, createdAt: new Date().toISOString() });
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
    isAuthenticated: !!user && !error,
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