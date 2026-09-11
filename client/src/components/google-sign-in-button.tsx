import { cn } from "@/lib/utils";
import { track } from "@/lib/track";

// "Continue with Google" — an optional shortcut next to the passwordless
// email form. It is a plain top-level navigation to the server's OAuth start
// route (not an XHR): Google's consent screen must be a full page load, and
// `target="_top"` breaks out of any embedding frame (Google refuses to render
// inside an iframe).

export const GOOGLE_SIGN_IN_PATH = "/auth/google";

// Query param the server appends to the post-Google redirect; consumed by
// useGoogleSignInReturn() in useAuth.
export const GOOGLE_RETURN_PARAM = "auth";
export const GOOGLE_RETURN_VALUE = "google";
// Single-use, session-bound endpoint that says whether this sign-in created
// a brand-new account (and so owes a Reddit SignUp pixel).
export const GOOGLE_SIGNUP_EVENT_PATH = "/auth/google/signup-event";

export function currentPathForReturn(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function googleSignInHref(returnTo: string = currentPathForReturn()): string {
  const params = new URLSearchParams({ returnTo });
  return `${GOOGLE_SIGN_IN_PATH}?${params.toString()}`;
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface GoogleSignInButtonProps {
  /** Same-origin path to return to after Google; defaults to the current page. */
  returnTo?: string;
  label?: string;
  className?: string;
  "data-testid"?: string;
}

export function GoogleSignInButton({
  returnTo,
  label = "Continue with Google",
  className,
  "data-testid": testId = "button-google-sign-in",
}: GoogleSignInButtonProps) {
  return (
    <a
      href={googleSignInHref(returnTo)}
      target="_top"
      rel="noopener"
      data-testid={testId}
      onClick={() => track("signup_started", { metadata: { method: "google" } })}
      className={cn(
        "inline-flex w-full items-center justify-center gap-3 rounded-md border border-white/15 bg-white px-4 py-2.5",
        "text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        className,
      )}
    >
      <GoogleMark className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </a>
  );
}

/** "or" separator between the email form and the Google button. */
export function OrDivider({ className, label = "or" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-xs uppercase tracking-wider text-slate-500", className)} aria-hidden="true">
      <span className="h-px flex-1 bg-white/10" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
