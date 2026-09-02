import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link, useLocation } from "wouter";
import { UserPlus, Users, Building2, Lock, Mail, MailCheck, Globe2, GitCompare, Radar, Shield, FileText, CheckCircle2 } from "lucide-react";

// Core platform access every new account gets immediately, regardless of
// persona — shown on the registration form itself so the value is visible
// before someone commits their work email. Icons echo the ones used for
// these same sections elsewhere in the app (nav, security page) for
// recognizability.
const REGISTRATION_BENEFITS: { icon: typeof Globe2; label: string }[] = [
  { icon: Globe2, label: "Access to all Markets" },
  { icon: GitCompare, label: "Vendor Evaluation & Comparison tools" },
  { icon: Radar, label: "Vendor Intelligence" },
  { icon: Shield, label: "CVE Security Intelligence" },
  { icon: FileText, label: "Datasheets" },
];

// Consumer email domains not accepted — company/work emails only.
export const CONSUMER_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "live.com", "aol.com", "protonmail.com", "me.com", "msn.com",
  "ymail.com", "googlemail.com", "yahoo.co.uk", "yahoo.co.in",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  "yandex.com", "mail.ru", "gmx.com", "gmx.net", "zoho.com",
]);

interface PersonaRegistrationFormProps {
  persona: "buyer" | "vendor";
  showToggle?: boolean;
  compact?: boolean;
}

export function PersonaRegistrationForm({ persona, showToggle = true, compact = false }: PersonaRegistrationFormProps) {
  const [, setLocation] = useLocation();
  const { register, registerError, isRegistering } = useAuth();
  const isVendorPersona = persona === "vendor";

  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!email.includes("@")) {
      newErrors.email = "Valid email is required";
    } else {
      const domain = email.split("@")[1]?.toLowerCase() ?? "";
      if (CONSUMER_DOMAINS.has(domain)) {
        newErrors.email = "Please use your company email address. Consumer email providers are not accepted.";
      }
    }

    if (!isVendorPersona && !termsAccepted) {
      newErrors.terms = "You must accept the Terms of Service to create a buyer account";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      await register({ email, persona });
      setSentTo(email);
    } catch {
      // Error is handled by useAuth hook
    }
  };

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
            access for the next 10 minutes — click the link anytime in that window to keep it permanently.
          </p>
          <Button
            className={`w-full text-white border-0 font-semibold ${
              isVendorPersona
                ? "bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400"
                : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
            }`}
            onClick={() => setLocation("/")}
          >
            Continue to itmap.ai
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900 border border-white/8 rounded-2xl shadow-2xl overflow-hidden ${compact ? "" : "w-full max-w-md mx-auto"}`}>
      <div className="p-5 sm:p-8 space-y-5">
        <div className="text-center space-y-2">
          <div className={`flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold mx-auto w-fit ${
            isVendorPersona
              ? "bg-violet-500/15 text-violet-300 border border-violet-400/20"
              : "bg-cyan-500/15 text-cyan-300 border border-cyan-400/20"
          }`}>
            {isVendorPersona ? <Building2 className="h-3 w-3" /> : <Users className="h-3 w-3" />}
            {isVendorPersona ? "Vendor Access" : "Buyer Access"}
          </div>
           <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-1.5 text-[11px] sm:text-xs font-bold text-emerald-300 text-center">
             <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
             Free to join · No credit card required
           </div>
          <h3 className="text-lg sm:text-xl font-bold text-white">
            {isVendorPersona ? "Create your Vendor account" : "Create your account"}
          </h3>
          <p className="text-sm text-slate-400">
            {isVendorPersona
              ? "Monitor your market position and access vendor intelligence tools"
              : "Get access to independent enterprise IT vendor intelligence"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {registerError && (
            <Alert variant="destructive">
              <AlertDescription>{registerError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor={`email-${persona}`} className="text-sm font-semibold text-white">
              Company email address
            </Label>
            <div className="relative">
              <Mail className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                isVendorPersona ? "text-violet-400" : "text-cyan-400"
              }`} />
              <Input
                id={`email-${persona}`}
                type="email"
                inputMode="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`h-12 pl-10 text-base bg-white/5 text-white placeholder:text-slate-500 border-2 focus-visible:ring-0 ${
                  isVendorPersona
                    ? "border-violet-400/30 focus-visible:border-violet-400/70"
                    : "border-cyan-400/30 focus-visible:border-cyan-400/70"
                }`}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </div>
            {errors.email && <p className="text-xs text-red-400">{errors.email}</p>}
            <p className="text-xs text-slate-500">No password needed — we'll email you a verification link.</p>
          </div>

          <div className={`rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] ${compact ? "p-3" : "p-4"}`}>
            <p className={`font-semibold text-emerald-300 ${compact ? "text-[11px] mb-2" : "text-xs mb-3"}`}>
              What you get, free the moment you sign up
            </p>
            <ul className={`grid gap-x-3 gap-y-2 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
              {REGISTRATION_BENEFITS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className={compact ? "text-xs" : "text-sm"}>{label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-1.5 border-t border-emerald-400/10 pt-3 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>All included, always free — no credit card, no trial limit</span>
            </div>
          </div>

          {!isVendorPersona && (
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`terms-${persona}`}
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  className="mt-0.5 border-white/20 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                />
                <label htmlFor={`terms-${persona}`} className="text-sm text-slate-300 leading-relaxed cursor-pointer">
                  I have read and agree to the{" "}
                  <Link href="/terms?returnTo=/buyer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                    ITMAP Terms of Service
                  </Link>
                  .
                </label>
              </div>
              {errors.terms && <p className="text-xs text-red-400">{errors.terms}</p>}
            </div>
          )}

          <Button
            type="submit"
            className={`w-full text-white border-0 font-semibold ${
              isVendorPersona
                ? "bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400"
                : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
            }`}
            disabled={isRegistering}
          >
            <UserPlus className="mr-2 h-4 w-4" />
             {isRegistering ? "Sending link…" : "Continue with email"}
          </Button>
        </form>

        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Lock className="h-3 w-3" />
          <span>Company email required · Consumer addresses not accepted</span>
        </div>

        <div className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href={`/login?persona=${persona}`} className="text-cyan-400 hover:text-cyan-300 hover:underline">
            Sign in
          </Link>
        </div>

        {showToggle && (
          <div className="text-center">
            <button
              onClick={() => {
                const next = isVendorPersona ? "buyer" : "vendor";
                localStorage.setItem("spectio_persona", next);
                window.location.href = `/${next}`;
              }}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              {isVendorPersona ? "Registering as a buyer instead?" : "Registering as a vendor instead?"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
