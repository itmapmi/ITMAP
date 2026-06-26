import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { UserPlus, Chrome, Linkedin } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";

export default function Register() {
  const [, setLocation] = useLocation();
  const { register, registerError, isRegistering } = useAuth();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (formData.firstName.length < 1) {
      newErrors.firstName = "First name is required";
    }
    if (formData.lastName.length < 1) {
      newErrors.lastName = "Last name is required";
    }
    if (!formData.email.includes("@")) {
      newErrors.email = "Valid email is required";
    }
    if (formData.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      const { confirmPassword, ...registerData } = formData;
      await register(registerData);
      toast({
        title: "Success",
        description: "Account created successfully",
      });
      setLocation("/");
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleOAuthLogin = (provider: 'google' | 'linkedin') => {
    window.location.href = `/auth/${provider}`;
  };

  const persona = (() => {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get("persona");
    if (qp === "buyer" || qp === "vendor") return qp;
    const stored = localStorage.getItem("spectio_persona");
    if (stored === "buyer" || stored === "vendor") return stored;
    return null;
  })();
  const isVendorPersona = persona === "vendor";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute inset-0 ${isVendorPersona ? "bg-[radial-gradient(ellipse_at_50%_30%,rgba(139,92,246,0.10),transparent_60%)]" : "bg-[radial-gradient(ellipse_at_50%_30%,rgba(14,165,233,0.10),transparent_60%)]"}`} />
      </div>
      <Card className="relative w-full max-w-md bg-slate-900 border border-white/8 shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <SpectioLogo size="lg" />
          </div>
          {persona && (
            <div className={`flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold mx-auto w-fit ${
              isVendorPersona ? "bg-violet-500/15 text-violet-300 border border-violet-400/20" : "bg-cyan-500/15 text-cyan-300 border border-cyan-400/20"
            }`}>
              {isVendorPersona ? "Vendor Access" : "Buyer Access"}
            </div>
          )}
          <CardTitle className="text-2xl text-center text-white">
            {isVendorPersona ? "Create your Vendor account" : "Create your account"}
          </CardTitle>
          <CardDescription className="text-center text-slate-400">
            {isVendorPersona
              ? "Monitor your market position and access vendor intelligence tools"
              : "Get access to independent enterprise IT vendor intelligence"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white hover:border-white/20" onClick={() => handleOAuthLogin('google')}>
              <Chrome className="mr-2 h-4 w-4" />
              Continue with Google
            </Button>
            <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white hover:border-white/20" onClick={() => handleOAuthLogin('linkedin')}>
              <Linkedin className="mr-2 h-4 w-4" />
              Continue with LinkedIn
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full bg-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-2 text-slate-500">Or register with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {registerError && (
              <Alert variant="destructive">
                <AlertDescription>{registerError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="text-slate-300">First Name</Label>
                <Input id="firstName" placeholder="John" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-slate-500" required />
                {errors.firstName && <p className="text-sm text-red-400">{errors.firstName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-slate-300">Last Name</Label>
                <Input id="lastName" placeholder="Doe" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-slate-500" required />
                {errors.lastName && <p className="text-sm text-red-400">{errors.lastName}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">Email</Label>
              <Input id="email" type="email" placeholder="john@example.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-slate-500" required />
              {errors.email && <p className="text-sm text-red-400">{errors.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Password</Label>
              <Input id="password" type="password" placeholder="Create a secure password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-slate-500" required />
              {errors.password && <p className="text-sm text-red-400">{errors.password}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password</Label>
              <Input id="confirmPassword" type="password" placeholder="Confirm your password" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-slate-500" required />
              {errors.confirmPassword && <p className="text-sm text-red-400">{errors.confirmPassword}</p>}
            </div>

            <Button
              type="submit"
              className={`w-full text-white border-0 font-semibold ${isVendorPersona ? "bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400" : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"}`}
              disabled={isRegistering}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {isRegistering ? "Creating Account..." : "Create Account"}
            </Button>
          </form>

          <div className="text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link href={`/login${persona ? `?persona=${persona}` : ""}`} className="text-cyan-400 hover:text-cyan-300 hover:underline">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}