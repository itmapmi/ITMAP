import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useDeviceDetection } from "@/shared/hooks";
import { useEffect } from "react";
import Navigation from "@/components/navigation";
import Home from "@/pages/home";
import About from "@/pages/About";
import Platform from "@/pages/Platform";
import Contact from "@/pages/Contact";
import Markets from "@/pages/markets";
import MarketDetails from "@/pages/market-details";
import Admin from "@/pages/admin";
import ReportViewer from "@/pages/report-viewer";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import NotFound from "@/pages/not-found";
import MobileApp from "./MobileApp";

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
  const { isMobileDevice } = useDeviceDetection();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const isAuthRoute = location === '/login' || location === '/register' || 
                       location === '/mobile/login' || location === '/mobile/register';
    
    if (isMobileDevice && !location.startsWith('/mobile') && !isAuthRoute) {
      if (isAuthenticated) {
        setLocation('/mobile/dashboard');
      } else {
        setLocation('/mobile/login');
      }
    } else if (isMobileDevice && (location === '/login' || location === '/register')) {
      setLocation(location === '/login' ? '/mobile/login' : '/mobile/register');
    } else if (!isMobileDevice && location.startsWith('/mobile')) {
      if (isAuthenticated) {
        setLocation('/');
      } else {
        setLocation('/login');
      }
    }
  }, [isMobileDevice, location, setLocation, isAuthenticated]);

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (isMobileDevice) {
    return <MobileApp />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
        <Route path="/platform" component={Platform} />
        <Route path="/contact" component={Contact} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/markets" component={Markets} />
        <Route path="/markets/:marketId" component={MarketDetails} />
        <Route path="/market/:marketId" component={MarketDetails} />
        <Route path="/admin" component={() => <ProtectedRoute component={Admin} requireAdmin={true} />} />
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
