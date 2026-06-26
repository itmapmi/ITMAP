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
import { LogIn, Chrome, Linkedin, Users, Building2 } from "lucide-react";
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
  const { login, loginError, isLoggingIn } = useAuth();
  const { toast } = useToast();
  const persona = getPersona();
  const isVendorPersona = persona === "vendor";
  const isBuyerPersona = persona === "buyer";

  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await login(formData);
      toast({ title: "Success", description: "Logged in successfully" });
      if (user?.role === "admin") {
        setLocation("/admin");
      } else {
        setLocation("/");
      }
    } catch {
      // Error handled by useAuth
    }
  };

  const handleOAuthLogin = (provider: "google" | "linkedin") => {
    window.location.href = `/auth/${provider}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e2130] py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute inset-0 ${isVendorPersona ? "bg-[radial-gradient(ellipse_at_50%_30%,rgba(139,92,246,0.10),transparent_60%)]" : "bg-[radial-gradient(ellipse_at_50%_30%,rgba(14,165,233,0.10),transparent_60%)]"}`} />
      </div>

      <Card className="relative w-full max-w-md bg-slate-900 border border-white/8 shadow-2xl">
        <CardHeader className="space-y-4 pb-4">
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
              {isVendorPersona ? "Sign in to your Vendor Hub" : isBuyerPersona ? "Sign in to your Intelligence Dashboard" : "Welcome back"}
            </CardTitle>
            <CardDescription className="mt-1 text-slate-400">
              {isVendorPersona
                ? "Monitor your market position and access vendor tools"
                : isBuyerPersona
                ? "All platform features are unlocked for your account"
                : "Sign in to access your technology intelligence platform"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white hover:border-white/20" onClick={() => handleOAuthLogin("google")}>
              <Chrome className="mr-2 h-4 w-4" />
              Continue with Google
            </Button>
            <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white hover:border-white/20" onClick={() => handleOAuthLogin("linkedin")}>
              <Linkedin className="mr-2 h-4 w-4" />
              Continue with LinkedIn
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full bg-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-2 text-slate-500">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {loginError && (
              <Alert variant="destructive">
                <AlertDescription>{loginError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50"
                required
              />
            </div>

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
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="text-center text-sm text-slate-400">
            Don't have an account?{" "}
            <Link href={`/register${persona ? `?persona=${persona}` : ""}`} className="text-cyan-400 hover:text-cyan-300 hover:underline">
              Sign up
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