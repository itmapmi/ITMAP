import { useAuth, useDeviceDetection } from "@/shared/hooks";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardContent, MobileCardHeader, MobileCardTitle } from "@/mobile/components/MobileCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { User, Mail, Shield, LogOut, Monitor, Smartphone } from "lucide-react";

export default function MobileProfile() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isMobileDevice, setMobileExperience } = useDeviceDetection();

  const handleLogout = async () => {
    try {
      await logout();
      toast({
        title: "Logged out",
        description: "You've been successfully logged out",
      });
      setLocation("/mobile/login");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const switchToDesktop = () => {
    setMobileExperience(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title="Profile"
        subtitle="Account Settings"
      />

      <div className="p-4 space-y-4">
        <MobileCard>
          <MobileCardContent className="py-6">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center mx-auto">
                <User className="h-10 w-10 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {user?.firstName} {user?.lastName}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{user?.email}</p>
              </div>
            </div>
          </MobileCardContent>
        </MobileCard>

        <MobileCard>
          <MobileCardHeader>
            <MobileCardTitle className="text-base">Account Information</MobileCardTitle>
          </MobileCardHeader>
          <MobileCardContent className="space-y-3">
            <div className="flex items-center gap-3 py-2">
              <Mail className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-600">{user?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <Shield className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">Role</p>
                <p className="text-sm text-gray-600 capitalize">{user?.role || 'User'}</p>
              </div>
            </div>
          </MobileCardContent>
        </MobileCard>

        <MobileCard>
          <MobileCardHeader>
            <MobileCardTitle className="text-base">View Preferences</MobileCardTitle>
          </MobileCardHeader>
          <MobileCardContent>
            <button
              onClick={switchToDesktop}
              className="w-full flex items-center justify-between py-3 hover:bg-gray-50 rounded-lg transition-colors"
              data-testid="button-switch-desktop"
            >
              <div className="flex items-center gap-3">
                <Monitor className="h-5 w-5 text-gray-500" />
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">Switch to Desktop View</p>
                  <p className="text-xs text-gray-500">View full desktop experience</p>
                </div>
              </div>
            </button>
          </MobileCardContent>
        </MobileCard>

        <Button
          onClick={handleLogout}
          variant="destructive"
          className="w-full h-12"
          data-testid="button-logout"
        >
          <LogOut className="h-5 w-5 mr-2" />
          Sign Out
        </Button>

        <div className="text-center pt-4 pb-8">
          <p className="text-xs text-gray-500">
            ITMAP Mobile v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
