import { useEffect, useState } from "react";
import { MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getPendingVerification, type PendingVerification } from "@/hooks/useAuth";

const GRACE_MS = 2 * 60 * 60 * 1000; // keep in sync with server/auth.ts EMAIL_VERIFICATION_GRACE_MS

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
// signed-in user is still inside their 2-hour verification grace period.
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
            Your 2-hour trial access for <strong className="text-slate-200">{pending.email}</strong> has ended.
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

// Decides whether the app should render the full-screen verification block
// instead of the normal router. Only true when there's no live session
// (server already denied it) AND the locally-remembered pending signup has
// passed its grace deadline.
export function usePendingVerificationBlock(): PendingVerification | null {
  const { isAuthenticated, isLoading } = useAuth();
  const now = useNow();

  if (isLoading || isAuthenticated) return null;
  const pending = getPendingVerification();
  if (!pending) return null;
  const deadline = new Date(pending.createdAt).getTime() + GRACE_MS;
  if (now < deadline) return null;
  return pending;
}
