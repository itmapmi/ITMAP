import { useState } from "react";
import { useAuth, VerificationRequiredError } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link, useLocation } from "wouter";
import { UserPlus, Mail, MailCheck } from "lucide-react";
import { MAX_UNVERIFIED_SESSIONS } from "@shared/verification";
import { COMPANY_PROFILE_PATH, isConsumerEmailDomain } from "@shared/company-email";
import { GoogleSignInButton, OrDivider } from "@/components/google-sign-in-button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { HighIntentAction } from "@/lib/high-intent";
import { resolveRegistrationCopy, BUYER_VALUE_PROPOSITION } from "@/lib/registration-copy";

export { BUYER_VALUE_PROPOSITION };

// There is a single self-service sign-up. Vendor seats are provisioned by
// admins (vendor scoping), never chosen at registration — so this form no
// longer takes a persona and the server ignores any it might receive.
interface PersonaRegistrationFormProps {
  compact?: boolean;
  /** Where "Continue with Google" lands afterwards; defaults to the current page. */
  googleReturnTo?: string;
  /**
   * The visitor's free preview has ended and this prompt can no longer be
   * dismissed — adjust the heading so it's clear an email is required to
   * continue.
   */
  forced?: boolean;
  /** Dynamic value proposition (e.g. mentioning the current market) to show instead of the generic line. */
  valueProposition?: string;
  /** The high-intent action (if any) that this specific prompt was shown for — drives tailored copy. */
  highIntentAction?: HighIntentAction | null;
}

export function PersonaRegistrationForm({
  compact = false,
  forced = false,
  googleReturnTo,
  valueProposition,
  highIntentAction,
}: PersonaRegistrationFormProps) {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const {
    register, registerError, isRegistering,
    resendVerification, isResendingVerification,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!email.includes("@")) {
      newErrors.email = "Valid email is required";
    }

    if (!termsAccepted) {
      newErrors.terms = "You must accept the Terms of Service to create an account";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setNeedsVerification(null);
    setResendSent(false);
    try {
      await register({ email });
      setSentTo(email);
    } catch (error) {
      if (error instanceof VerificationRequiredError) {
        // Signing up with an email that already has an unverified account —
        // offer to resend the link instead of just showing the raw error.
        setNeedsVerification(error.email);
      }
      // Any other error is surfaced via registerError below.
    }
  };

  const handleResend = async () => {
    if (!needsVerification) return;
    try {
      await resendVerification(needsVerification);
      setResendSent(true);
    } catch {
      // Error is handled by useAuth hook
    }
  };

  if (needsVerification) {
    return (
      <div className={`bg-slate-900 border border-white/8 rounded-2xl shadow-2xl overflow-hidden ${compact ? "" : "max-w-md mx-auto"}`}>
        <div className="p-5 sm:p-8 space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/15 flex items-center justify-center">
            <MailCheck className="h-6 w-6 text-amber-400" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white">Almost there — verify your email</h3>
          <p className="text-sm text-slate-400">
            <strong className="text-slate-200">{needsVerification}</strong> already has an account, but it
            hasn't been verified yet. Click the link we emailed you, or send a new one below.
          </p>
          <Button
            className="w-full text-white border-0 font-semibold bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
            disabled={isResendingVerification || resendSent}
            onClick={handleResend}
          >
            {resendSent ? "Email sent — check your inbox" : isResendingVerification ? "Sending…" : "Resend verification email"}
          </Button>
          <button
            onClick={() => { setNeedsVerification(null); setResendSent(false); }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Try a different email
          </button>
        </div>
      </div>
    );
  }

  if (sentTo) {
    return (
      <div className={`bg-slate-900 border border-white/8 rounded-2xl shadow-2xl overflow-hidden ${compact ? "" : "max-w-md mx-auto"}`}>
        <div className="p-5 sm:p-8 space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <MailCheck className="h-6 w-6 text-emerald-400" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white">You're in — check your inbox</h3>
          <p className="text-sm text-slate-400">
            We've sent a verification link to <strong className="text-slate-200">{sentTo}</strong>. You have full
            access right now — click the link within your first {MAX_UNVERIFIED_SESSIONS} visits to keep it permanently.
          </p>
          <Button
            className="w-full text-white border-0 font-semibold bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
            onClick={() => setLocation("/")}
          >
            Continue to itmap.ai
          </Button>
          {/* Consumer-domain buyers are gated out of Reports / News / the
              Intelligence Feed until they verify a company email
              (shared/company-email.ts). Say so up front instead of letting
              them discover it from a locked tab. */}
          {isConsumerEmailDomain(sentTo) && (
            <p className="text-xs text-slate-500" data-testid="text-company-profile-hint">
              Using a personal email? Complete your short company profile to unlock Reports, News and the
              Intelligence Feed —{" "}
              <Link href={COMPANY_PROFILE_PATH} className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                complete it now
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    );
  }

  const { heading, bodyValueProp } = resolveRegistrationCopy({ forced, highIntentAction, valueProposition });

  const emailForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
          {registerError && (
            <Alert variant="destructive">
              <AlertDescription>{registerError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email-signup" className="text-sm font-semibold text-white">
              Enter email
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-400" />
              <Input
                id="email-signup"
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 pl-11 text-lg bg-white/5 text-white placeholder:text-slate-500 border-2 border-cyan-400/30 focus-visible:border-cyan-400/70 focus-visible:ring-0"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </div>
            {errors.email && <p className="text-xs text-red-400">{errors.email}</p>}
          </div>

          <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms-signup"
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  className="mt-0.5 border-white/20 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                />
                <label htmlFor="terms-signup" className="text-sm text-slate-300 leading-relaxed cursor-pointer">
                  I have read and agree to the{" "}
                  <Link href="/termsofservice?returnTo=/buyer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                    ITMAP Terms of Service
                  </Link>
                  .
                </label>
              </div>
              {errors.terms && <p className="text-xs text-red-400">{errors.terms}</p>}
          </div>

          <Button
            type="submit"
            className="w-full text-white border-0 font-semibold bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
            disabled={isRegistering}
            data-testid="button-sign-up"
          >
            <UserPlus className="mr-2 h-4 w-4" />
             {isRegistering ? "Signing up…" : "Sign up"}
          </Button>
    </form>
  );

  const googleBlock = (
    <div className="space-y-2">
      <GoogleSignInButton returnTo={googleReturnTo} data-testid="button-google-sign-in" />
      <p className="text-center text-xs text-slate-500">
        By continuing with Google you agree to the{" "}
        <Link href="/termsofservice?returnTo=/buyer" className="text-slate-400 hover:text-slate-200 hover:underline">
          ITMAP Terms of Service
        </Link>
        .
      </p>
    </div>
  );

  return (
    <div className={`bg-slate-900 border border-white/8 rounded-2xl shadow-2xl overflow-hidden ${compact ? "" : "w-full max-w-md mx-auto"}`}>
      <div className="p-5 sm:p-8 space-y-5">
        <div className="text-center space-y-2">
          <h3 className="text-lg sm:text-xl font-bold text-white" data-testid="text-registration-heading">
            {heading}
          </h3>
          <p className="text-sm leading-relaxed text-slate-300" data-testid="text-registration-value-prop">
            {bodyValueProp}
          </p>
        </div>

        {/* Google is the fastest signup path (no typing, no verification
            email to wait for) — lead with it on mobile where every extra
            step costs more conversion. */}
        {isMobile ? (
          <>
            {googleBlock}
            <OrDivider />
            {emailForm}
          </>
        ) : (
          <>
            {emailForm}
            <OrDivider />
            {googleBlock}
          </>
        )}

        <div className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-cyan-400 hover:text-cyan-300 hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
