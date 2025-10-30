import { useState } from "react";
import { useAuth } from "@/shared/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { Chrome, Linkedin, Eye, EyeOff } from "lucide-react";
import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

export default function MobileLogin() {
  const [, setLocation] = useLocation();
  const { login, loginError, isLoggingIn } = useAuth();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await login(formData);
      toast({
        title: "Welcome back!",
        description: "You've successfully logged in",
      });
      setLocation("/mobile/dashboard");
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleOAuthLogin = (provider: 'google' | 'linkedin') => {
    window.location.href = `/auth/${provider}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-12">
        <div className="space-y-8">
          <div className="text-center space-y-4">
            <img src={itmapLogo} alt="ITMAP" className="h-24 w-auto mx-auto" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
              <p className="text-gray-600 mt-2">
                <span className="text-blue-600 font-medium">Unbiased. Comprehensive.</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Sign in to access your technology intelligence platform
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Button
              variant="outline"
              className="w-full h-14 text-base"
              onClick={() => handleOAuthLogin('google')}
              data-testid="button-google-login"
            >
              <Chrome className="mr-3 h-5 w-5" />
              Continue with Google
            </Button>
            <Button
              variant="outline"
              className="w-full h-14 text-base"
              onClick={() => handleOAuthLogin('linkedin')}
              data-testid="button-linkedin-login"
            >
              <Linkedin className="mr-3 h-5 w-5" />
              Continue with LinkedIn
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4 text-gray-500">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {loginError && (
              <Alert variant="destructive">
                <AlertDescription>{loginError}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-base">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                className="h-14 text-base"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                data-testid="input-email"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-base">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  className="h-14 text-base pr-12"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-14 text-base font-semibold" 
              disabled={isLoggingIn}
              data-testid="button-submit-login"
            >
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{" "}
              <Link href="/mobile/register">
                <a className="text-blue-600 font-semibold hover:text-blue-700" data-testid="link-register">
                  Sign up
                </a>
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
