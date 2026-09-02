import { useEffect, useRef } from "react";
import { Switch, Route, useLocation } from "wouter";
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
import Pricing from "@/pages/Pricing";
import Markets from "@/pages/markets";
import MarketDetails from "@/pages/market-details";
import Admin from "@/pages/admin";
import MarketBuilderPage from "@/pages/market-builder";
import MyMarketBuilderPage from "@/pages/my-market-builder";
import ForecastBuilderPage from "@/pages/forecast-builder/index";
import ForecastDetailPage from "@/pages/forecast-builder/detail";
import ForecastReportPage from "@/pages/forecast-builder/report";
import { ForecastThemeProvider } from "@/components/forecast/forecast-theme";
import MyReportsPage from "@/pages/my-reports";
import MyRfpsPage from "@/pages/my-rfps";
import MyRfpDetailPage from "@/pages/my-rfp-detail";
import MyMarketVendorsPage from "@/pages/my-market-vendors";
import MyLlmKeysPage from "@/pages/my-llm-keys";
import MyProfile from "@/pages/my-profile";
import MySettings from "@/pages/my-settings";
import ReportViewer from "@/pages/report-viewer";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import BuyerLandingPage from "@/pages/buyer";
import VendorLandingPage from "@/pages/vendor";
import TermsPage from "@/pages/terms";
import PrivacyPage from "@/pages/privacy";
import NotFound from "@/pages/not-found";
import DatasheetsIndexPage from "@/pages/datasheets/index";
import DatasheetComparePage from "@/pages/datasheets/compare";
import DatasheetSavedPage from "@/pages/datasheets/saved";
import DatasheetSharePage from "@/pages/datasheets/share-view";
import LeadGenOverviewPage from "@/pages/lead-gen/index";
import LeadGenDetailPage from "@/pages/lead-gen/detail";
import LeadGenVendorPage from "@/pages/lead-gen/vendor";
import LeadGenMyVendorPage from "@/pages/lead-gen/me";
import FactReviewPage from "@/pages/lead-gen/fact-review";
import RfpResponderPage from "@/pages/rfp-responder/index";
import RfpSessionDetailPage from "@/pages/rfp-responder/session-detail";
import BattleCardsIndexPage from "@/pages/battle-cards/index";
import BattleCardDetailPage from "@/pages/battle-cards/detail";
import MyToolsPage from "@/pages/me/tools";
import SecurityPage from "@/pages/security/index";
import { trackPageView } from "@/lib/track";
import { captureRedditClickId, trackRedditPageVisit } from "@/lib/reddit-pixel";
import { TeaserGateProvider } from "@/hooks/use-registration-teaser";
import { VerificationBlockScreen, VerificationReminderDialog, usePendingVerificationBlock } from "@/components/email-verification-gate";
import { PENDING_VERIFICATION_KEY } from "@/hooks/useAuth";

function TrafficPageTracker() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    captureRedditClickId();
  }, []);

  useEffect(() => {
    trackPageView();
    if (isFirstRender.current) {
      // The Reddit Pixel base snippet (client/index.html) already fires the
      // initial PageVisit on document load — skip it here to avoid double-counting.
      isFirstRender.current = false;
    } else {
      trackRedditPageVisit();
    }
  }, [location]);

  return null;
}

function ProtectedRoute({ component: Component, requireAdmin = false, buyerOnly = false }: {
  component: React.ComponentType;
  requireAdmin?: boolean;
  buyerOnly?: boolean;
}) {
  const { isAuthenticated, isAdmin, isLoading, isVendorScoped, user } = useAuth();

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

  // Buyer-only routes: redirect vendor-persona users back to their dashboard
  const isVendorUser = isVendorScoped || (user as any)?.persona === "vendor";
  if (buyerOnly && isVendorUser && !isAdmin) {
    window.location.replace("/");
    return null;
  }

  return <Component />;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const pendingBlock = usePendingVerificationBlock();

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (pendingBlock) {
    return (
      <VerificationBlockScreen
        pending={pendingBlock}
        onUseDifferentEmail={() => {
          try { localStorage.removeItem(PENDING_VERIFICATION_KEY); } catch { /* noop */ }
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <VerificationReminderDialog />
      <Navigation />
      <TrafficPageTracker />
      <TeaserGateProvider>
        <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
        <Route path="/platform" component={Platform} />
        <Route path="/contact" component={Contact} />
        <Route path="/licensing" component={Licensing} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/buyer" component={BuyerLandingPage} />
        <Route path="/vendor" component={VendorLandingPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/markets" component={Markets} />
        <Route path="/markets/:marketId" component={MarketDetails} />
        <Route path="/market/:marketId" component={MarketDetails} />
        {/* NOTE: routes that need to wrap their target in <ProtectedRoute> (or
            another wrapper) use the `<Route path="..">{() => <.../>}</Route>`
            children-function form, never `component={() => <.../>}`. wouter
            renders `component` via createElement(component, ...), so a fresh
            inline arrow function there is a *new component type* on every
            render of this Router — React then unmounts/remounts the whole
            subtree (replaying mount animations, looking like a "reload")
            any time anything causes Router() itself to re-render, however
            unrelated. The children-function form is just called to produce
            JSX, so the rendered element's own (stable) type is what React
            reconciles against — immune to how often the parent re-renders. */}
        <Route path="/admin">{() => <ProtectedRoute component={Admin} requireAdmin={true} />}</Route>
        {/* /market-builder is shared: admins see the admin wizard, end users
            are redirected to /me/market-builder via the page itself. */}
        <Route path="/market-builder">{() => <ProtectedRoute component={MarketBuilderPage} />}</Route>
        <Route path="/lead-gen">{() => <ProtectedRoute component={LeadGenOverviewPage} requireAdmin={true} />}</Route>
        <Route path="/lead-gen/vendors/:vendorId">{() => <ProtectedRoute component={LeadGenVendorPage} requireAdmin={true} />}</Route>
        <Route path="/lead-gen/me">{() => <ProtectedRoute component={LeadGenMyVendorPage} />}</Route>
        <Route path="/lead-gen/me/fact-review">{() => <ProtectedRoute component={FactReviewPage} />}</Route>
        <Route path="/rfp-responder">{() => <ProtectedRoute component={RfpResponderPage} />}</Route>
        <Route path="/rfp-responder/sessions/:id">{() => <ProtectedRoute component={RfpSessionDetailPage} />}</Route>
        <Route path="/battle-cards">{() => <ProtectedRoute component={BattleCardsIndexPage} />}</Route>
        <Route path="/battle-cards/:marketId">{() => <ProtectedRoute component={BattleCardDetailPage} />}</Route>
        <Route path="/security">{() => <ProtectedRoute component={SecurityPage} />}</Route>
        <Route path="/lead-gen/:userId">{() => <ProtectedRoute component={LeadGenDetailPage} requireAdmin={true} />}</Route>
        <Route path="/me/market-builder">{() => <ProtectedRoute component={MyMarketBuilderPage} />}</Route>
        <Route path="/forecast-builder">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastBuilderPage} /></ForecastThemeProvider>}</Route>
        <Route path="/forecast-builder/:id/report">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastReportPage} /></ForecastThemeProvider>}</Route>
        <Route path="/forecast-builder/:id">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastDetailPage} /></ForecastThemeProvider>}</Route>
        <Route path="/me/reports">{() => <ProtectedRoute component={MyReportsPage} buyerOnly={true} />}</Route>
        <Route path="/me/rfps">{() => <ProtectedRoute component={MyRfpsPage} buyerOnly={true} />}</Route>
        <Route path="/me/rfps/:id">{() => <ProtectedRoute component={MyRfpDetailPage} buyerOnly={true} />}</Route>
        <Route path="/me/markets/:marketId/vendors">{() => <ProtectedRoute component={MyMarketVendorsPage} />}</Route>
        <Route path="/me/settings/llm-keys">{() => <ProtectedRoute component={MyLlmKeysPage} />}</Route>
        <Route path="/me/profile">{() => <ProtectedRoute component={MyProfile} />}</Route>
        <Route path="/me/settings">{() => <ProtectedRoute component={MySettings} />}</Route>
        <Route path="/me/tools">{() => <ProtectedRoute component={MyToolsPage} />}</Route>
        <Route path="/report/:reportId" component={ReportViewer} />
        <Route path="/datasheets" component={DatasheetsIndexPage} />
        <Route path="/me/comparisons">{() => <ProtectedRoute component={DatasheetSavedPage} />}</Route>
        <Route path="/datasheets/saved">{() => <ProtectedRoute component={DatasheetSavedPage} />}</Route>
        <Route path="/share/comparison/:token" component={DatasheetSharePage} />
        <Route path="/datasheets/:slug" component={DatasheetComparePage} />
        <Route component={NotFound} />
      </Switch>
      </TeaserGateProvider>
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
