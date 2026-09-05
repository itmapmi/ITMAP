import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2, Briefcase, Mail, Save, CheckCircle2, Clock, AlertCircle, RefreshCw, Lock, Newspaper, FileText, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { isConsumerEmailDomain } from "@shared/company-email";

/**
 * Company profile card on /me/profile (shared/company-email.ts).
 *
 * Buyers who signed up with a consumer-domain address complete company name,
 * company email and designation here; a verification link goes to the
 * company address and, once clicked, Reports / News / Intelligence Feed
 * unlock. The login email is never changed. Shown to every signed-in user
 * (business-domain accounts can still record their company details), but
 * the "unlocks…" framing only appears for accounts that are actually gated.
 */

interface CompanyProfile {
  companyName: string | null;
  designation: string | null;
  companyEmail: string | null;
  companyEmailVerified: boolean;
  companyEmailVerificationSentAt: string | null;
  needsCompanyEmailVerification: boolean;
}

// Mirrors the server cooldown between verification emails.
const RESEND_COOLDOWN_SECONDS = 60;

function useResendCountdown(sentAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sentAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sentAt]);
  if (!sentAt) return 0;
  const elapsed = (now - new Date(sentAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || fallback);
}

export function CompanyProfileCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  const { data: profile, isLoading } = useQuery<CompanyProfile>({
    queryKey: ["/api/me/company-profile"],
  });

  const [companyName, setCompanyName] = useState("");
  const [designation, setDesignation] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!profile || seeded) return;
    setCompanyName(profile.companyName ?? "");
    setDesignation(profile.designation ?? "");
    setCompanyEmail(profile.companyEmail ?? "");
    setSeeded(true);
  }, [profile, seeded]);

  // Landing flag from the emailed link: /me/profile?company=verified|invalid|taken
  const [banner, setBanner] = useState<"verified" | "invalid" | "taken" | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("company");
    if (flag === "verified" || flag === "invalid" || flag === "taken") {
      setBanner(flag);
      // The account row changed server-side; refresh so locks disappear
      // without a re-login.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/company-profile"] });
      params.delete("company");
      const rest = params.toString();
      navigate(`${window.location.pathname}${rest ? `?${rest}` : ""}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/me/company-profile"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyName, designation, companyEmail }),
      });
      if (!res.ok) throw await readError(res, "Could not save your profile");
      return res.json() as Promise<CompanyProfile & { emailSent: boolean }>;
    },
    onSuccess: (data) => {
      refresh();
      setBanner(null);
      toast({
        title: data.emailSent ? "Verification email sent" : "Profile saved",
        description: data.emailSent
          ? `Check ${data.companyEmail} and click the link to unlock reports and news.`
          : undefined,
      });
    },
    onError: (err: Error) => {
      refresh();
      toast({ title: "Could not save profile", description: err.message, variant: "destructive" });
    },
  });

  const resend = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me/company-profile/resend", { method: "POST", credentials: "include" });
      if (!res.ok) throw await readError(res, "Could not resend the verification email");
      return res.json() as Promise<CompanyProfile>;
    },
    onSuccess: (data) => {
      refresh();
      toast({ title: "Verification email sent", description: `We've sent a new link to ${data.companyEmail}.` });
    },
    onError: (err: Error) => {
      refresh();
      toast({ title: "Could not resend", description: err.message, variant: "destructive" });
    },
  });

  const cooldown = useResendCountdown(profile?.companyEmailVerificationSentAt);
  const consumerTyped = companyEmail.includes("@") && isConsumerEmailDomain(companyEmail);
  const unchanged =
    !!profile &&
    companyName.trim() === (profile.companyName ?? "") &&
    designation.trim() === (profile.designation ?? "") &&
    companyEmail.trim().toLowerCase() === (profile.companyEmail ?? "").toLowerCase();
  const canSave = companyName.trim().length >= 2 && designation.trim().length >= 2 && companyEmail.includes("@") && !consumerTyped && !save.isPending;

  const gated = profile?.needsCompanyEmailVerification ?? false;
  const verified = profile?.companyEmailVerified ?? false;
  const pending = !!profile?.companyEmail && !verified;
  const inputClass = "bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="mt-4 bg-slate-900 border border-white/5 rounded-2xl p-8"
      data-testid="card-company-profile"
    >
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Company profile</h2>
        </div>
        {!isLoading && (
          verified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300" data-testid="status-company-verified">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verified
            </span>
          ) : pending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300" data-testid="status-company-pending">
              <Clock className="h-3.5 w-3.5" /> Verification pending
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-400" data-testid="status-company-unverified">
              <Lock className="h-3.5 w-3.5" /> Not verified
            </span>
          )
        )}
      </div>

      {banner === "verified" && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200" role="status" data-testid="banner-company-verified">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-emerald-100">Company email verified</p>
            <p className="mt-0.5 text-emerald-200/80">Research reports, market news and the intelligence feed are now unlocked. You can keep signing in the same way as before.</p>
          </div>
        </div>
      )}
      {banner === "invalid" && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200" role="alert" data-testid="banner-company-invalid">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-red-100">That verification link is no longer valid</p>
            <p className="mt-0.5 text-red-200/80">It may have been used already or replaced by a newer email. Request a fresh link below.</p>
          </div>
        </div>
      )}
      {banner === "taken" && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200" role="alert" data-testid="banner-company-taken">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-red-100">This company email is already verified on another account</p>
            <p className="mt-0.5 text-red-200/80">Use a different work address, or sign in with the account that owns it.</p>
          </div>
        </div>
      )}

      {gated && !verified && (
        <div className="mb-6 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-4">
          <p className="text-sm text-slate-200">
            Complete your short profile and confirm your company email to unlock — it's free.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <li className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-cyan-400" /> Research reports</li>
            <li className="inline-flex items-center gap-1.5"><Newspaper className="h-3.5 w-3.5 text-cyan-400" /> Market news</li>
            <li className="inline-flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-cyan-400" /> Intelligence feed</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Your sign-in email ({user?.email}) stays the same.
          </p>
        </div>
      )}

      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName" className="text-slate-400 text-sm">Company name</Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="companyName"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                className={`${inputClass} pl-10`}
                data-testid="input-company-name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="designation" className="text-slate-400 text-sm">Designation</Label>
            <div className="relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="designation"
                value={designation}
                onChange={e => setDesignation(e.target.value)}
                placeholder="Head of IT"
                className={`${inputClass} pl-10`}
                data-testid="input-designation"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="companyEmail" className="text-slate-400 text-sm">Company email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              id="companyEmail"
              type="email"
              value={companyEmail}
              onChange={e => setCompanyEmail(e.target.value)}
              placeholder="you@company.com"
              className={`${inputClass} pl-10`}
              aria-invalid={consumerTyped || undefined}
              data-testid="input-company-email"
            />
          </div>
          {consumerTyped ? (
            <p className="text-xs text-red-300" data-testid="error-consumer-domain">
              Please use your work email address — personal mailboxes can't be used as a company email.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              We'll send a verification link to this address. It won't replace your sign-in email.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            onClick={() => save.mutate()}
            disabled={!canSave || unchanged}
            className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
            data-testid="button-save-company-profile"
          >
            <Save className="h-4 w-4 mr-2" />
            {save.isPending ? "Saving…" : verified ? "Save changes" : "Submit & send verification link"}
          </Button>

          {pending && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => resend.mutate()}
              disabled={resend.isPending || cooldown > 0}
              className="text-slate-300 hover:text-white"
              data-testid="button-resend-company-verification"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${resend.isPending ? "animate-spin" : ""}`} />
              {cooldown > 0 ? `Resend verification link (${cooldown}s)` : "Resend verification link"}
            </Button>
          )}
        </div>

        {pending && profile?.companyEmail && (
          <p className="text-xs text-slate-500" data-testid="text-company-pending">
            Verification email sent to <span className="text-slate-300">{profile.companyEmail}</span>
            {profile.companyEmailVerificationSentAt
              ? ` · ${new Date(profile.companyEmailVerificationSentAt).toLocaleString()}`
              : ""}
            . Check your inbox (and spam folder) and click the link to verify.
          </p>
        )}
        {verified && profile?.companyEmail && (
          <p className="text-xs text-slate-500" data-testid="text-company-verified">
            <span className="text-slate-300">{profile.companyEmail}</span> is verified. Changing it will require verifying the new address.
          </p>
        )}
      </div>
    </motion.div>
  );
}
