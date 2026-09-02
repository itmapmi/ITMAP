import { useEffect, useState } from "react";
import { MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getPendingVerification, type PendingVerification } from "@/hooks/useAuth";

const GRACE_MS = 10 * 60 * 1000; // keep in sync with server/auth.ts EMAIL_VERIFICATION_GRACE_MS
// After this much of the grace period has elapsed, show a one-time dismissible
// reminder popup. Dismissing it does not extend access — the account is still
// blocked at GRACE_MS regardless.
const REMINDER_AFTER_MS = 5 * 60 * 1000;
const REMINDER_DISMISSED_KEY = "itmap_verification_reminder_dismissed";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0m 0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
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
// within the grace window doesn't re-show a popup the user already closed,
// but a different / newly-registered account still gets its own reminder.
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
// signed-in user is still inside their verification grace period.
export function VerificationBanner() {
  const { user } = useAuth();
  const now = useNow();

  if (!user || (user as any).emailVerified !== false || !user.createdAt) return null;

  const deadline = new Date(user.createdAt as unknown as string).getTime() + GRACE_MS;
  const remaining = deadline - now;
  if (remaining <= 0) return null; // server will cut the session shortly; avoid a flash of a "0m" banner

  return (
    <div className="bg-amber-500/15 border-b border-amber-400/30 text-amber-200 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-center">
        <MailCheck className="h-4 w-4 shrink-0" />
        <span>
          Verify <strong>{user.email}</strong> to keep your access — {formatRemaining(remaining)} left.
        </span>
        <ResendButton email={user.email!} className="border-amber-400/40 text-amber-100 hover:bg-amber-400/10 bg-transparent h-7" />
      </div>
    </div>
  );
}

// Full-screen block shown once the grace period has expired for an account
// that never clicked the verification link. Session-based access has
// already been cut server-side by this point; this reads the client-only
// "pending verification" marker (see useAuth) to explain why, since the
// generic logged-out state would otherwise look identical.
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
            Your 10-minute trial access for <strong className="text-slate-200">{pending.email}</strong> has ended.
            Click the verification link we emailed you to unlock your account again.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <ResendButton email={pending.email} className="w-full border-white/10 text-slate-200 hover:bg-white/5 bg-transparent" />
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

// One-time popup shown partway through the grace period (once REMINDER_AFTER_MS
// has elapsed) nudging the user to verify. Closing it does not pause or extend
// the countdown — the account is still blocked once the full grace period is up.
export function VerificationReminderDialog() {
  const { user } = useAuth();
  const now = useNow();
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  const unverified = !!user && (user as any).emailVerified === false && !!user.createdAt;
  const email = unverified ? (user!.email as string) : null;
  const createdAtMs = unverified ? new Date(user!.createdAt as unknown as string).getTime() : 0;
  const elapsed = unverified ? now - createdAtMs : 0;
  const deadline = createdAtMs + GRACE_MS;
  const remaining = deadline - now;

  const shouldShow =
    unverified &&
    !!email &&
    elapsed >= REMINDER_AFTER_MS &&
    remaining > 0 &&
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
          <DialogTitle className="text-center">Don't forget to verify your email</DialogTitle>
          <DialogDescription className="text-center">
            We sent a verification link to <strong>{email}</strong>. Verify now to keep your access —
            you have {email ? formatRemaining(remaining) : ""} left before it's locked.
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
// instead of the normal router. Only true when there's no live session
// (server already denied it) AND the locally-remembered pending signup has
// passed its grace deadline.
export function usePendingVerificationBlock(): PendingVerification | null {
  const { isAuthenticated, isLoading } = useAuth();
  // Only tick the 1/sec clock while it can actually matter (logged-out with
  // a pending marker to expire). Ticking unconditionally forced this hook's
  // caller (the top-level Router) to re-render every few seconds for every
  // visitor, including signed-in admins — which, combined with routes
  // declared as `component={() => <.../>}` (a fresh function identity each
  // render), made React treat the current route as a new component type and
  // remount it wholesale, replaying its mount animations. That looked like
  // the whole page "reloading" itself every couple of seconds. See
  // App.tsx's Route definitions, which now avoid the `component` prop
  // pattern entirely so this class of bug can't recur even if this hook's
  // timing changes again.
  const pending = !isLoading && !isAuthenticated ? getPendingVerification() : null;
  const now = useNow(pending ? 5_000 : 60_000);

  if (isLoading || isAuthenticated || !pending) return null;
  const deadline = new Date(pending.createdAt).getTime() + GRACE_MS;
  if (now < deadline) return null;
  return pending;
}
