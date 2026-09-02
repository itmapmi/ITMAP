import { useState } from "react";
import { useAuth, VerificationRequiredError, PasswordRequiredError } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { LogIn, UserPlus, MailCheck } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMarketId?: string;
}

export default function AuthModal({ isOpen, onClose, selectedMarketId }: AuthModalProps) {
  const [, setLocation] = useLocation();
  const {
    login, register, loginError, registerError, isLoggingIn, isRegistering,
    resendVerification, isResendingVerification,
  } = useAuth();
  const { toast } = useToast();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loginFormError, setLoginFormError] = useState<string | null>(null);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const validateRegisterForm = () => {
    const newErrors: Record<string, string> = {};
    if (!registerEmail.includes("@")) {
      newErrors.email = "Valid email is required";
    }
    setRegisterErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goToDestination = (user: any) => {
    if (selectedMarketId) {
      setLocation(`/markets/${selectedMarketId}`);
    } else if (user?.role === 'admin') {
      setLocation("/admin");
    } else {
      setLocation("/");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setNeedsVerification(null);
    setResendSent(false);
    setLoginFormError(null);
    try {
      const user = await login(needsPassword ? { email: loginEmail, password: loginPassword } : { email: loginEmail });
      toast({ title: "Success", description: "Logged in successfully" });
      onClose();
      goToDestination(user);
    } catch (error) {
      if (error instanceof VerificationRequiredError) {
        setNeedsVerification(error.email);
      } else if (error instanceof PasswordRequiredError) {
        // Not a real error — this account just needs its password too.
        setNeedsPassword(true);
      } else {
        setLoginFormError(error instanceof Error ? error.message : "Sign in failed.");
      }
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateRegisterForm()) return;

    try {
      await register({ email: registerEmail });
      setSentTo(registerEmail);
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleResend = async (email: string) => {
    try {
      await resendVerification(email);
      setResendSent(true);
    } catch {
      // surfaced via loginError-equivalent below
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <SpectioLogo variant="dark" />
          </div>
          <DialogTitle className="text-center text-xl">
            Sign in to access market analysis
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
            <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login" className="space-y-4">
            <div className="text-center text-sm text-gray-600 mb-4">
              <span className="text-blue-600 font-medium">Unbiased. Comprehensive.</span><br />
              Sign in to access your technology intelligence platform
            </div>

            {needsVerification ? (
              <div className="space-y-4 text-center py-2">
                <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <MailCheck className="h-6 w-6 text-amber-600" />
                </div>
                <p className="text-sm text-gray-600">
                  Your access window for <strong>{needsVerification}</strong> has ended. Click the link we emailed
                  you, or send a new one below.
                </p>
                <Button
                  className="w-full"
                  disabled={isResendingVerification || resendSent}
                  onClick={() => handleResend(needsVerification)}
                >
                  {resendSent ? "Email sent — check your inbox" : isResendingVerification ? "Sending…" : "Resend verification email"}
                </Button>
                <button
                  onClick={() => { setNeedsVerification(null); setResendSent(false); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                {loginFormError && (
                  <Alert variant="destructive">
                    <AlertDescription>{loginFormError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="Enter your email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    disabled={needsPassword}
                    data-testid="input-email-login"
                  />
                  {!needsPassword && (
                    <p className="text-xs text-gray-500">No password needed — just your work email.</p>
                  )}
                </div>

                {needsPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="Enter your password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      autoFocus
                      autoComplete="current-password"
                      data-testid="input-password-login"
                    />
                    <button
                      type="button"
                      onClick={() => { setNeedsPassword(false); setLoginPassword(""); setLoginFormError(null); }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Use a different email
                    </button>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-submit-login">
                  <LogIn className="mr-2 h-4 w-4" />
                  {isLoggingIn ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            )}
          </TabsContent>
          
          <TabsContent value="register" className="space-y-4">
            <div className="text-center text-sm text-gray-600 mb-4">
              <span className="text-blue-600 font-medium">Unbiased. Comprehensive.</span><br />
              Create your account to start your free trial
            </div>

            {sentTo ? (
              <div className="space-y-4 text-center py-2">
                <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <MailCheck className="h-6 w-6 text-emerald-600" />
                </div>
                <p className="text-sm text-gray-600">
                  We've sent a verification link to <strong>{sentTo}</strong>. You have full access for the next
                  10 minutes — click the link anytime in that window to keep it permanently.
                </p>
                <Button
                  className="w-full"
                  onClick={() => { onClose(); goToDestination(null); }}
                >
                  Continue to itmap.ai
                </Button>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                {registerError && (
                  <Alert variant="destructive">
                    <AlertDescription>{registerError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="Enter your email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    required
                    data-testid="input-email-register"
                  />
                  {registerErrors.email && (
                    <p className="text-sm text-red-600">{registerErrors.email}</p>
                  )}
                  <p className="text-xs text-gray-500">No password needed — we'll email you a verification link.</p>
                </div>

                <Button type="submit" className="w-full" disabled={isRegistering} data-testid="button-submit-register">
                  <UserPlus className="mr-2 h-4 w-4" />
                  {isRegistering ? "Sending link…" : "Continue with email"}
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
