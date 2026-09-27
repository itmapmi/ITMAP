import { useEffect, useRef } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, useGoogleSignInReturn } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import MobileNavigation from "@/components/mobile-navigation";
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
import PrivacyPage, { PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH } from "@/pages/privacy";
import NotFound from "@/pages/not-found";
import DatasheetsIndexPage from "@/pages/datasheets/index";
import DatasheetComparePage from "@/pages/datasheets/compare";
import DatasheetSavedPage from "@/pages/datasheets/saved";
import DatasheetSharePage from "@/pages/datasheets/share-view";
import LeadGenOverviewPage from "@/pages/lead-gen/index";
import LeadGenDetailPage from "@/pages/lead-gen/detail";
import LeadGenVendorPage from "@/pages/lead-gen/vendor";
import LeadGenMyVendorPage from "@/pages/lead-gen/me";
import LeadGenMyLeadDetailPage from "@/pages/lead-gen/me-detail";
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
import { VIEW_MODE_COOKIE, readCookieValue, resolveMobileRedirect } from "@shared/mobile-paths";

/**
 * Client-side mirror of server/mobileRedirect.ts. The server only sees cold
 * page loads and hard refreshes; every in-app tap (dashboard → market card,
 * nav → Security Intelligence, → RFP Builder, ...) is routed by wouter and
 * never leaves the browser. Without this, a phone user who arrived on the
 * home page could tap through the whole app and only ever see the desktop
 * pages. Returns the /mobile/* path the current location should become, or
 * null when the current location is already correct.
 */
function useMobileRedirectTarget(location: string): string | null {
  if (typeof document === "undefined") return null;
  return resolveMobileRedirect(
    location,
    readCookieValue(document.cookie, VIEW_MODE_COOKIE),
    navigator.userAgent,
  );
}

function MobileRouteGuard({ target }: { target: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    // `replace` so the desktop URL never lands in history — otherwise Back
    // would bounce straight into another redirect.
    navigate(target + window.location.search + window.location.hash, { replace: true });
  }, [navigate, target]);
  return null;
}

function GoogleSignInReturnHandler() {
  useGoogleSignInReturn();
  return null;
}

/**
 * wouter's client-side navigation never touches the browser's native scroll
 * handling the way a full page load does, so without this, navigating to a
 * new route leaves the window at whatever scroll depth the previous page was
 * left at. Resets to the top on every route change, except when the new URL
 * carries a hash (an in-page anchor link, which should scroll to that
 * section instead).
 */
function ScrollToTop() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip on first mount: this is a fresh page load, where the browser's
    // own scroll position (or restored scroll, e.g. after a refresh) should
    // be left alone.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [location]);

  return null;
}

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
  const [location] = useLocation();
  const mobileRedirectTarget = useMobileRedirectTarget(location);

  // Decided before anything else renders so the desktop page never mounts
  // (and never fires its queries / page-view tracking) on a phone.
  if (mobileRedirectTarget) {
    return <MobileRouteGuard target={mobileRedirectTarget} />;
  }

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

  const isMobileRoute = location.startsWith("/mobile/") || location === "/mobile";

  return (
    <div className="min-h-screen">
      <VerificationReminderDialog />
      {isMobileRoute ? <MobileNavigation /> : <Navigation />}
      <ScrollToTop />
      <TrafficPageTracker />
      <GoogleSignInReturnHandler />
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
        <Route path={TERMS_OF_SERVICE_PATH} component={TermsPage} />
        <Route path={PRIVACY_POLICY_PATH} component={PrivacyPage} />
        {/* Legacy legal URLs — keep old links (emails, search results) working. */}
        <Route path="/terms">{() => <Redirect to={`${TERMS_OF_SERVICE_PATH}${window.location.search}`} replace />}</Route>
        <Route path="/privacy">{() => <Redirect to={`${PRIVACY_POLICY_PATH}${window.location.search}`} replace />}</Route>
        <Route path="/markets" component={Markets} />
        <Route path="/markets/:marketId" component={MarketDetails} />
        <Route path="/market/:marketId" component={MarketDetails} />
        {/* Mobile experience: path-based, not a same-URL responsive tweak — see
            shared/mobile-paths.ts. Phones get redirected here server-side
            (server/mobileRedirect.ts); desktop users can opt in via the
            manual toggle in Navigation. The pages below detect the /mobile
            prefix themselves (via useViewMode()/location) and render a
            condensed layout while reusing the same data-fetching logic. */}
        <Route path="/mobile/markets/:marketId" component={MarketDetails} />
        <Route path="/mobile/market/:marketId" component={MarketDetails} />
        <Route path="/mobile/report/:reportId" component={ReportViewer} />
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
        <Route path="/lead-gen/me/:userId">{() => <ProtectedRoute component={LeadGenMyLeadDetailPage} />}</Route>
        <Route path="/rfp-responder">{() => <ProtectedRoute component={RfpResponderPage} />}</Route>
        <Route path="/rfp-responder/sessions/:id">{() => <ProtectedRoute component={RfpSessionDetailPage} />}</Route>
        <Route path="/battle-cards">{() => <ProtectedRoute component={BattleCardsIndexPage} />}</Route>
        <Route path="/battle-cards/:marketId">{() => <ProtectedRoute component={BattleCardDetailPage} />}</Route>
        <Route path="/security">{() => <ProtectedRoute component={SecurityPage} />}</Route>
        <Route path="/mobile/security">{() => <ProtectedRoute component={SecurityPage} />}</Route>
        <Route path="/lead-gen/:userId">{() => <ProtectedRoute component={LeadGenDetailPage} requireAdmin={true} />}</Route>
        <Route path="/me/market-builder">{() => <ProtectedRoute component={MyMarketBuilderPage} />}</Route>
        <Route path="/forecast-builder">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastBuilderPage} /></ForecastThemeProvider>}</Route>
        <Route path="/forecast-builder/:id/report">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastReportPage} /></ForecastThemeProvider>}</Route>
        <Route path="/forecast-builder/:id">{() => <ForecastThemeProvider><ProtectedRoute component={ForecastDetailPage} /></ForecastThemeProvider>}</Route>
        <Route path="/me/reports">{() => <ProtectedRoute component={MyReportsPage} buyerOnly={true} />}</Route>
        <Route path="/me/rfps">{() => <ProtectedRoute component={MyRfpsPage} buyerOnly={true} />}</Route>
        <Route path="/me/rfps/:id">{() => <ProtectedRoute component={MyRfpDetailPage} buyerOnly={true} />}</Route>
        <Route path="/mobile/me/rfps">{() => <ProtectedRoute component={MyRfpsPage} buyerOnly={true} />}</Route>
        <Route path="/mobile/me/rfps/:id">{() => <ProtectedRoute component={MyRfpDetailPage} buyerOnly={true} />}</Route>
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
