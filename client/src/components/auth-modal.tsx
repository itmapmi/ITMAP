import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { LogIn, UserPlus, Chrome, Linkedin } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMarketId?: string;
}

export default function AuthModal({ isOpen, onClose, selectedMarketId }: AuthModalProps) {
  const [, setLocation] = useLocation();
  const { login, register, loginError, registerError, isLoggingIn, isRegistering } = useAuth();
  const { toast } = useToast();
  
  const [loginData, setLoginData] = useState({
    email: "",
    password: "",
  });

  const [registerData, setRegisterData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});

  const validateRegisterForm = () => {
    const newErrors: Record<string, string> = {};

    if (registerData.firstName.length < 1) {
      newErrors.firstName = "First name is required";
    }
    if (registerData.lastName.length < 1) {
      newErrors.lastName = "Last name is required";
    }
    if (!registerData.email.includes("@")) {
      newErrors.email = "Valid email is required";
    }
    if (registerData.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }
    if (registerData.password !== registerData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setRegisterErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const user = await login(loginData);
      toast({
        title: "Success",
        description: "Logged in successfully",
      });
      onClose();
      
      // Navigate to the selected market if specified
      if (selectedMarketId) {
        setLocation(`/markets/${selectedMarketId}`);
      } else if (user?.role === 'admin') {
        setLocation("/admin");
      } else {
        setLocation("/");
      }
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateRegisterForm()) {
      return;
    }

    try {
      const { confirmPassword, ...registerFormData } = registerData;
      await register(registerFormData);
      toast({
        title: "Success",
        description: "Account created successfully",
      });
      onClose();
      
      // Navigate to the selected market if specified
      if (selectedMarketId) {
        setLocation(`/markets/${selectedMarketId}`);
      } else {
        setLocation("/");
      }
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleOAuthLogin = (provider: 'google' | 'linkedin') => {
    // Store the intended destination for after OAuth
    if (selectedMarketId) {
      sessionStorage.setItem('oauth_redirect', `/markets/${selectedMarketId}`);
    }
    window.location.href = `/auth/${provider}`;
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
            
            {/* OAuth Buttons */}
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOAuthLogin('google')}
                data-testid="button-google-login"
              >
                <Chrome className="mr-2 h-4 w-4" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOAuthLogin('linkedin')}
                data-testid="button-linkedin-login"
              >
                <Linkedin className="mr-2 h-4 w-4" />
                Continue with LinkedIn
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with email
                </span>
              </div>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <Alert variant="destructive">
                  <AlertDescription>{loginError}</AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="Enter your email"
                  value={loginData.email}
                  onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                  required
                  data-testid="input-email-login"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={loginData.password}
                  onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                  required
                  data-testid="input-password-login"
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-submit-login">
                <LogIn className="mr-2 h-4 w-4" />
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </TabsContent>
          
          <TabsContent value="register" className="space-y-4">
            <div className="text-center text-sm text-gray-600 mb-4">
              <span className="text-blue-600 font-medium">Unbiased. Comprehensive.</span><br />
              Create your account to start your free trial
            </div>
            
            {/* OAuth Buttons */}
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOAuthLogin('google')}
                data-testid="button-google-register"
              >
                <Chrome className="mr-2 h-4 w-4" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOAuthLogin('linkedin')}
                data-testid="button-linkedin-register"
              >
                <Linkedin className="mr-2 h-4 w-4" />
                Continue with LinkedIn
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or register with email
                </span>
              </div>
            </div>

            {/* Register Form */}
            <form onSubmit={handleRegister} className="space-y-4">
              {registerError && (
                <Alert variant="destructive">
                  <AlertDescription>{registerError}</AlertDescription>
                </Alert>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="register-firstName">First Name</Label>
                  <Input
                    id="register-firstName"
                    type="text"
                    placeholder="First name"
                    value={registerData.firstName}
                    onChange={(e) => setRegisterData({ ...registerData, firstName: e.target.value })}
                    required
                    data-testid="input-firstName-register"
                  />
                  {registerErrors.firstName && (
                    <p className="text-sm text-red-600">{registerErrors.firstName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-lastName">Last Name</Label>
                  <Input
                    id="register-lastName"
                    type="text"
                    placeholder="Last name"
                    value={registerData.lastName}
                    onChange={(e) => setRegisterData({ ...registerData, lastName: e.target.value })}
                    required
                    data-testid="input-lastName-register"
                  />
                  {registerErrors.lastName && (
                    <p className="text-sm text-red-600">{registerErrors.lastName}</p>
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder="Enter your email"
                  value={registerData.email}
                  onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                  required
                  data-testid="input-email-register"
                />
                {registerErrors.email && (
                  <p className="text-sm text-red-600">{registerErrors.email}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  placeholder="Enter your password"
                  value={registerData.password}
                  onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                  required
                  data-testid="input-password-register"
                />
                {registerErrors.password && (
                  <p className="text-sm text-red-600">{registerErrors.password}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="register-confirmPassword">Confirm Password</Label>
                <Input
                  id="register-confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={registerData.confirmPassword}
                  onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                  required
                  data-testid="input-confirmPassword-register"
                />
                {registerErrors.confirmPassword && (
                  <p className="text-sm text-red-600">{registerErrors.confirmPassword}</p>
                )}
              </div>
              
              <Button type="submit" className="w-full" disabled={isRegistering} data-testid="button-submit-register">
                <UserPlus className="mr-2 h-4 w-4" />
                {isRegistering ? "Creating Account..." : "Create Account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}