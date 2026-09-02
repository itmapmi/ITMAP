import { useState } from "react";
import { useAuth, VerificationRequiredError, PasswordRequiredError } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { LogIn, Users, Building2, Lock, MailCheck } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";

function getPersona(): "buyer" | "vendor" | null {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get("persona");
  if (qp === "buyer" || qp === "vendor") return qp;
  const stored = localStorage.getItem("spectio_persona");
  if (stored === "buyer" || stored === "vendor") return stored;
  return null;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, loginError, isLoggingIn, resendVerification, isResendingVerification } = useAuth();
  const { toast } = useToast();
  const persona = getPersona();
  const isVendorPersona = persona === "vendor";
  const isBuyerPersona = persona === "buyer";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNeedsVerification(null);
    setResendSent(false);
    setFormError(null);
    try {
      const user = await login(needsPassword ? { email, password } : { email });
      toast({ title: "Welcome back", description: "Signed in successfully" });
      if (user?.role === "admin") {
        setLocation("/admin");
      } else {
        setLocation("/");
      }
    } catch (err) {
      if (err instanceof VerificationRequiredError) {
        setNeedsVerification(err.email);
      } else if (err instanceof PasswordRequiredError) {
        // Not a real error — this account just needs its password too.
        setNeedsPassword(true);
      } else {
        setFormError(err instanceof Error ? err.message : "Sign in failed.");
      }
    }
  };

  const handleResend = async () => {
    if (!needsVerification) return;
    try {
      await resendVerification(needsVerification);
      setResendSent(true);
    } catch {
      // surfaced via resendVerificationError below
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute inset-0 ${
          isVendorPersona
            ? "bg-[radial-gradient(ellipse_at_50%_30%,rgba(139,92,246,0.10),transparent_60%)]"
            : "bg-[radial-gradient(ellipse_at_50%_30%,rgba(14,165,233,0.10),transparent_60%)]"
        }`} />
      </div>

      <Card className="relative w-full max-w-md bg-slate-900 border border-white/8 shadow-2xl">
        <CardHeader className="space-y-4 pb-2">
          <div className="flex justify-center">
            <SpectioLogo size="lg" />
          </div>

          {persona && (
            <div className={`flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mx-auto w-fit ${
              isVendorPersona
                ? "bg-violet-500/15 text-violet-300 border border-violet-400/20"
                : "bg-cyan-500/15 text-cyan-300 border border-cyan-400/20"
            }`}>
              {isVendorPersona ? <Building2 className="h-3 w-3" /> : <Users className="h-3 w-3" />}
              {isVendorPersona ? "Vendor Access" : "Buyer Access"}
            </div>
          )}

          <div className="text-center">
            <CardTitle className="text-xl text-white">
              {isVendorPersona
                ? "Sign in to your Vendor Hub"
                : isBuyerPersona
                ? "Sign in to your Intelligence Dashboard"
                : "Welcome back"}
            </CardTitle>
            <CardDescription className="mt-1 text-slate-400">
              {isVendorPersona
                ? "Monitor your market position and access vendor tools"
                : isBuyerPersona
                ? "Independent IT vendor intelligence, built for enterprise buyers"
                : "Sign in to access your technology intelligence platform"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          {needsVerification ? (
            <div className="space-y-4 text-center py-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/15 flex items-center justify-center">
                <MailCheck className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold">Verify your email to sign in</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Your access window for <strong className="text-slate-200">{needsVerification}</strong> has ended.
                  Click the link we emailed you, or send a new one below.
                </p>
              </div>
              <Button
                onClick={handleResend}
                disabled={isResendingVerification || resendSent}
                className={`w-full text-white border-0 font-semibold ${
                  isVendorPersona
                    ? "bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400"
                    : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
                }`}
              >
                {resendSent ? "Email sent — check your inbox" : isResendingVerification ? "Sending…" : "Resend verification email"}
              </Button>
              <button
                onClick={() => { setNeedsVerification(null); setResendSent(false); }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50"
                  autoComplete="email"
                  required
                  disabled={needsPassword}
                />
                {!needsPassword && (
                  <p className="text-xs text-slate-500">No password needed — just your work email.</p>
                )}
              </div>

              {needsPassword && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50"
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => { setNeedsPassword(false); setPassword(""); setFormError(null); }}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Use a different email
                  </button>
                </div>
              )}

              <Button
                type="submit"
                className={`w-full text-white border-0 font-semibold ${
                  isVendorPersona
                    ? "bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400"
                    : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
                }`}
                disabled={isLoggingIn}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {isLoggingIn ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          )}

          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-600">
            <Lock className="h-3 w-3" />
            <span>Company email required · Enterprise access only</span>
          </div>

          <div className="text-center text-sm text-slate-400">
            Don't have an account?{" "}
            <Link href={`/register${persona ? `?persona=${persona}` : ""}`} className="text-cyan-400 hover:text-cyan-300 hover:underline">
              Create account
            </Link>
          </div>

          {persona && (
            <div className="text-center">
              <button
                onClick={() => { localStorage.removeItem("spectio_persona"); window.location.href = "/login"; }}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Wrong access type? Switch persona
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
