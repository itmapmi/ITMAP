import { useEffect, useState } from "react";
import { MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useAuth,
  getPendingVerification,
  PENDING_VERIFICATION_EVENT,
  type PendingVerification,
} from "@/hooks/useAuth";
import { MAX_UNVERIFIED_SESSIONS, unverifiedSessionsRemaining } from "@shared/verification";
import { GoogleSignInButton, OrDivider } from "@/components/google-sign-in-button";

// Verification policy (enforced server-side, see shared/verification.ts): an
// unverified account gets MAX_UNVERIFIED_SESSIONS independent sign-in
// sessions. The reminder popup is shown once per account when they start
// their last allowed session; dismissing it changes nothing — the next
// sign-in is refused until the emailed link has been clicked.
const REMINDER_DISMISSED_KEY = "itmap_verification_reminder_dismissed";

function sessionsWord(n: number): string {
  return n === 1 ? "session" : "sessions";
}

// Number of unverified sessions the signed-in user has consumed so far, as
// reported by the server on the user row.
function sessionsUsedOf(user: any): number {
  return typeof user?.unverifiedSessionCount === "number" ? user.unverifiedSessionCount : 0;
}

function useNow(intervalMs = 5_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Dismissal is remembered per-account (keyed by email) so a page refresh
// during the last allowed session doesn't re-show a popup the user already
// closed, but a different / newly-registered account still gets its own.
function isReminderDismissed(email: string): boolean {
  try {
    return localStorage.getItem(REMINDER_DISMISSED_KEY) === email;
  } catch {
    return false;
  }
}

function dismissReminder(email: string) {
  try {
    localStorage.setItem(REMINDER_DISMISSED_KEY, email);
  } catch {
    // ignore
  }
}

function ResendButton({ email, className }: { email: string; className?: string }) {
  const { resendVerification, isResendingVerification } = useAuth();
  const { toast } = useToast();
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const now = useNow(1000);
  const onCooldown = now < cooldownUntil;

  const handleResend = async () => {
    try {
      await resendVerification(email);
      toast({ title: "Verification email sent", description: `Check ${email} for the link.` });
      setCooldownUntil(Date.now() + 60_000);
    } catch (err: any) {
      toast({ title: "Couldn't resend email", description: err?.message ?? "Please try again shortly.", variant: "destructive" });
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleResend}
      disabled={isResendingVerification || onCooldown}
      className={className}
    >
      {onCooldown ? `Resend in ${Math.ceil((cooldownUntil - now) / 1000)}s` : isResendingVerification ? "Sending…" : "Resend email"}
    </Button>
  );
}

// Slim, dismissible-by-nature (goes away once verified) banner shown while a
// signed-in user still has unverified sessions available.
export function VerificationBanner() {
  const { user } = useAuth();

  if (!user || (user as any).emailVerified !== false) return null;

  const used = sessionsUsedOf(user);
  const remaining = unverifiedSessionsRemaining({ emailVerified: false, unverifiedSessionCount: used });

  return (
    <div className="bg-amber-950 border-b border-amber-800 text-amber-50 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-center">
        <MailCheck className="h-4 w-4 shrink-0" />
        <span data-testid="text-verification-banner">
          Verify <strong>{user.email}</strong> to keep your access —{" "}
          {remaining > 0
            ? `${remaining} more free ${sessionsWord(remaining)} after this one.`
            : "this is your last session before verification is required."}
        </span>
        <ResendButton email={user.email!} className="border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200 hover:text-amber-950 h-7" />
      </div>
    </div>
  );
}

// Full-screen block shown once an account has used all of its unverified
// sessions without clicking the verification link. Session-based access has
// already been cut (or refused) server-side by this point; this reads the
// client-only "pending verification" marker (see useAuth) to explain why,
// since the generic logged-out state would otherwise look identical.
export function VerificationBlockScreen({ pending, onUseDifferentEmail }: {
  pending: PendingVerification;
  onUseDifferentEmail: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] px-4">
      <div className="max-w-md w-full bg-slate-900 border border-white/8 rounded-2xl shadow-2xl p-8 text-center space-y-5">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/15 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Verify your email to continue</h1>
          <p className="text-sm text-slate-400 mt-2">
            <strong className="text-slate-200">{pending.email}</strong> has used its {MAX_UNVERIFIED_SESSIONS} free
            sessions. Click the verification link we emailed you to unlock your account again.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <ResendButton email={pending.email} className="w-full border-white/10 text-slate-200 hover:bg-white/5 bg-transparent" />
          <OrDivider className="my-1" />
          {/* Google has already verified the address, so this both signs in
              and completes verification in one step. */}
          <GoogleSignInButton label="Verify instantly with Google" data-testid="button-google-sign-in-verify" />
          <button
            onClick={onUseDifferentEmail}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    </div>
  );
}

// One-time popup shown when an unverified user starts their LAST allowed
// session, nudging them to verify. Closing it changes nothing — the next
// sign-in is refused until the link has been clicked.
export function VerificationReminderDialog() {
  const { user } = useAuth();
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  const unverified = !!user && (user as any).emailVerified === false;
  const email = unverified ? (user!.email as string) : null;
  const onLastSession = unverified && sessionsUsedOf(user) >= MAX_UNVERIFIED_SESSIONS;

  const shouldShow =
    unverified &&
    !!email &&
    onLastSession &&
    !manuallyDismissed &&
    !isReminderDismissed(email);

  const handleClose = () => {
    if (email) dismissReminder(email);
    setManuallyDismissed(true);
  };

  return (
    <Dialog open={shouldShow} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/15 flex items-center justify-center mb-2">
            <MailCheck className="h-6 w-6 text-amber-500" />
          </div>
          <DialogTitle className="text-center">Last session before verification</DialogTitle>
          <DialogDescription className="text-center">
            We sent a verification link to <strong>{email}</strong>. This is the last of your{" "}
            {MAX_UNVERIFIED_SESSIONS} free sessions — click the link before your next visit to keep your access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          {email && <ResendButton email={email} className="w-full" />}
          <Button variant="ghost" size="sm" onClick={handleClose}>
            I'll do it later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Decides whether the app should render the full-screen verification block
// instead of the normal router. Only true when there's no live session AND
// the locally-remembered pending signup has run out of unverified sessions —
// either because the server refused the last sign-in attempt, or because the
// last allowed session has ended (cookie expired) and any new one would be
// refused.
//
// Deliberately event-driven rather than polled: a periodic re-render here
// forces the top-level Router to re-render for every visitor (see the note
// on Route definitions in App.tsx).
export function usePendingVerificationBlock(): PendingVerification | null {
  const { isAuthenticated, isLoading } = useAuth();
  const [pending, setPending] = useState<PendingVerification | null>(() => getPendingVerification());

  useEffect(() => {
    const refresh = () => setPending(getPendingVerification());
    window.addEventListener(PENDING_VERIFICATION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PENDING_VERIFICATION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (isLoading || isAuthenticated || !pending) return null;
  const exhausted =
    pending.verificationRequired === true ||
    (typeof pending.sessionsUsed === "number" && pending.sessionsUsed >= MAX_UNVERIFIED_SESSIONS);
  return exhausted ? pending : null;
}
