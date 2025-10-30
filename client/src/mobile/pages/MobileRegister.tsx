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

export default function MobileRegister() {
  const [, setLocation] = useLocation();
  const { register, registerError, isRegistering } = useAuth();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
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
        title: "Welcome!",
        description: "Your account has been created successfully",
      });
      setLocation("/mobile/dashboard");
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleOAuthRegister = (provider: 'google' | 'linkedin') => {
    window.location.href = `/auth/${provider}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center px-6 py-12">
        <div className="space-y-6">
          <div className="text-center space-y-3">
            <img src={itmapLogo} alt="ITMAP" className="h-20 w-auto mx-auto" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Create Account</h1>
              <p className="text-gray-600 mt-1">
                <span className="text-blue-600 font-medium">Unbiased. Comprehensive.</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Join ITMAP to access technology intelligence
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => handleOAuthRegister('google')}
              data-testid="button-google-register"
            >
              <Chrome className="mr-2 h-5 w-5" />
              Sign up with Google
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => handleOAuthRegister('linkedin')}
              data-testid="button-linkedin-register"
            >
              <Linkedin className="mr-2 h-5 w-5" />
              Sign up with LinkedIn
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4 text-gray-500">Or sign up with email</span>
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
                <Label htmlFor="firstName" className="text-sm">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  className="h-12"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                  data-testid="input-firstname"
                />
                {errors.firstName && (
                  <p className="text-xs text-red-600">{errors.firstName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-sm">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  className="h-12"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                  data-testid="input-lastname"
                />
                {errors.lastName && (
                  <p className="text-xs text-red-600">{errors.lastName}</p>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                className="h-12"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                data-testid="input-email"
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 6 characters"
                  className="h-12 pr-12"
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
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter your password"
                  className="h-12 pr-12"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  required
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
                  data-testid="button-toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-600">{errors.confirmPassword}</p>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold" 
              disabled={isRegistering}
              data-testid="button-submit-register"
            >
              {isRegistering ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <Link href="/mobile/login">
                <a className="text-blue-600 font-semibold hover:text-blue-700" data-testid="link-login">
                  Sign in
                </a>
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
