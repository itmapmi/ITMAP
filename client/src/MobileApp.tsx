import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/shared/hooks";

import MobileLogin from "@/mobile/pages/MobileLogin";
import MobileRegister from "@/mobile/pages/MobileRegister";
import MobileDashboard from "@/mobile/pages/MobileDashboard";
import MobileMarketDetails from "@/mobile/pages/MobileMarketDetails";
import MobileVendorDetails from "@/mobile/pages/MobileVendorDetails";
import MobilePlatform from "@/mobile/pages/MobilePlatform";
import MobileContactUs from "@/mobile/pages/MobileContactUs";
import MobileLayout from "@/mobile/components/MobileLayout";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <MobileLogin />;
  }

  return (
    <MobileLayout>
      <Component />
    </MobileLayout>
  );
}

function MobileRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Switch>
        <Route path="/mobile/login" component={MobileLogin} />
        <Route path="/mobile/register" component={MobileRegister} />
        <Route path="/mobile" component={() => <ProtectedRoute component={MobileDashboard} />} />
        <Route path="/mobile/dashboard" component={() => <ProtectedRoute component={MobileDashboard} />} />
        <Route path="/mobile/platform" component={() => <ProtectedRoute component={MobilePlatform} />} />
        <Route path="/mobile/contact" component={() => <ProtectedRoute component={MobileContactUs} />} />
        <Route path="/mobile/markets/:marketId" component={() => <ProtectedRoute component={MobileMarketDetails} />} />
        <Route path="/mobile/vendors/:vendorId" component={() => <ProtectedRoute component={MobileVendorDetails} />} />
        <Route component={() => <ProtectedRoute component={MobileDashboard} />} />
      </Switch>
    </div>
  );
}

function MobileApp() {
  return (
    <TooltipProvider>
      <Toaster />
      <MobileRouter />
    </TooltipProvider>
  );
}

export default MobileApp;
