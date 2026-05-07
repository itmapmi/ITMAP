import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import Home from "@/pages/home";
import About from "@/pages/About";
import Platform from "@/pages/Platform";
import Contact from "@/pages/Contact";
import Licensing from "@/pages/Licensing";
import Markets from "@/pages/markets";
import MarketDetails from "@/pages/market-details";
import Admin from "@/pages/admin";
import MarketBuilderPage from "@/pages/market-builder";
import MyMarketBuilderPage from "@/pages/my-market-builder";
import ForecastBuilderPage from "@/pages/forecast-builder/index";
import ForecastDetailPage from "@/pages/forecast-builder/detail";
import MyReportsPage from "@/pages/my-reports";
import MyLlmKeysPage from "@/pages/my-llm-keys";
import MyProfile from "@/pages/my-profile";
import MySettings from "@/pages/my-settings";
import ReportViewer from "@/pages/report-viewer";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component, requireAdmin = false }: { component: React.ComponentType, requireAdmin?: boolean }) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (requireAdmin && !isAdmin) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p>You don't have permission to access this page.</p>
      </div>
    </div>;
  }

  return <Component />;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen">
      <Navigation />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
        <Route path="/platform" component={Platform} />
        <Route path="/contact" component={Contact} />
        <Route path="/licensing" component={Licensing} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/markets" component={Markets} />
        <Route path="/markets/:marketId" component={MarketDetails} />
        <Route path="/market/:marketId" component={MarketDetails} />
        <Route path="/admin" component={() => <ProtectedRoute component={Admin} requireAdmin={true} />} />
        {/* /market-builder is shared: admins see the admin wizard, end users
            are redirected to /me/market-builder via the page itself. */}
        <Route path="/market-builder" component={() => <ProtectedRoute component={MarketBuilderPage} />} />
        <Route path="/me/market-builder" component={() => <ProtectedRoute component={MyMarketBuilderPage} />} />
        <Route path="/forecast-builder" component={() => <ProtectedRoute component={ForecastBuilderPage} />} />
        <Route path="/forecast-builder/:id" component={() => <ProtectedRoute component={ForecastDetailPage} />} />
        <Route path="/me/reports" component={() => <ProtectedRoute component={MyReportsPage} />} />
        <Route path="/me/settings/llm-keys" component={() => <ProtectedRoute component={MyLlmKeysPage} />} />
        <Route path="/me/profile"  component={() => <ProtectedRoute component={MyProfile} />} />
        <Route path="/me/settings" component={() => <ProtectedRoute component={MySettings} />} />
        <Route path="/report/:reportId" component={ReportViewer} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
