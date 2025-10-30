import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/shared/hooks";

import MobileLogin from "@/mobile/pages/MobileLogin";
import MobileRegister from "@/mobile/pages/MobileRegister";
import MobileDashboard from "@/mobile/pages/MobileDashboard";
import MobileMarkets from "@/mobile/pages/MobileMarkets";
import MobileMarketDetails from "@/mobile/pages/MobileMarketDetails";
import MobileVendors from "@/mobile/pages/MobileVendors";
import MobileVendorDetails from "@/mobile/pages/MobileVendorDetails";
import MobileNews from "@/mobile/pages/MobileNews";
import MobileProfile from "@/mobile/pages/MobileProfile";
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
        <Route path="/mobile/markets" component={() => <ProtectedRoute component={MobileMarkets} />} />
        <Route path="/mobile/markets/:marketId" component={() => <ProtectedRoute component={MobileMarketDetails} />} />
        <Route path="/mobile/vendors" component={() => <ProtectedRoute component={MobileVendors} />} />
        <Route path="/mobile/vendors/:vendorId" component={() => <ProtectedRoute component={MobileVendorDetails} />} />
        <Route path="/mobile/news" component={() => <ProtectedRoute component={MobileNews} />} />
        <Route path="/mobile/profile" component={() => <ProtectedRoute component={MobileProfile} />} />
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
