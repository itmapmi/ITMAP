import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { track, trackDwell } from "@/lib/track";
import { useRoute, Link } from "wouter";
import { ArrowLeft, FileDown, Lock, ArrowRight, ExternalLink, Move, Save, X, ChevronDown, MessageSquare } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { FREE_MARKET_ID } from "@/pages/markets";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import MagicQuadrant from "@/components/magic-quadrant";
import SupportMatrix from "@/components/support-matrix";
import EcosystemSupport from "@/components/ecosystem-support";
import ResearchMethodology from "@/components/research-methodology";
import { NewPlayers } from "@/components/new-players";
import { ResearchReports } from "@/components/research-reports";
import { MarketNews } from "@/components/market-news";
import { VendorSelectionModal } from "@/components/vendor-selection-modal";
import { Chat } from "@/components/Chat";
import { IntelligenceFeed } from "@/components/intelligence-feed";
import { VendorNewsroomManager } from "@/components/vendor-newsroom-manager";
import { LockedFeatureTooltip } from "@/components/locked-feature-tooltip";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { getErrorMessage, isMissingLlmKeyError } from "@/lib/rfp-errors";
import { useLocation } from "wouter";
import { marketSlug } from "@/lib/market-slug";
import { useMutation } from "@tanstack/react-query";
import type { Market, Vendor } from "@shared/schema";
import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";
import { ChartLoading, LoadingSpinner, SkeletonCard } from "@/components/ui/loading-animations";

function useCreateRfpForMarket() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (vars: { marketId: string; marketName: string }) => {
      const title = `${vars.marketName.replace(/^ITMAP for /i, "")} RFP — ${new Date().toLocaleDateString()}`;
      return await apiRequestJson("/api/me/rfps", "POST", { marketId: vars.marketId, title }) as { id: string };
    },
    onSuccess: (created) => navigate(`/me/rfps/${created.id}`),
    onError: (e: unknown) => {
      if (isMissingLlmKeyError(e)) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        navigate("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Could not start RFP", description: getErrorMessage(e), variant: "destructive" });
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MarketDetails() {
  const [match, params] = useRoute("/markets/:marketId");
  const marketId = params?.marketId;
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const { isAuthenticated, user, isAdmin, hasFeature, isVendorScoped } = useAuth();
  // Technology buyers should not see the Intelligence section
  const isBuyerUser = isAuthenticated && !isVendorScoped && (user as any)?.persona !== "vendor" && !isAdmin;
  const createRfpMutation = useCreateRfpForMarket();
  const { toast } = useToast();

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [activeTab, setActiveTab] = useState("vendor-evaluation");
  const [chatOpen, setChatOpen] = useState(false);

  const { data: market, isLoading, error } = useQuery<Market>({
    queryKey: ["/api/markets", marketId],
    enabled: !!marketId,
  });

  // Use the resolved UUID from the market object for all sub-resource API calls.
  // This ensures slug-based URLs (e.g. /markets/backup_and_recovery) work correctly
  // because sub-routes only accept UUIDs, not slugs.
  const resolvedId = market?.id;
  const isFreeMarket = resolvedId === FREE_MARKET_ID || marketId === FREE_MARKET_ID;

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", resolvedId, "vendors"],
    enabled: !!resolvedId,
  });

  // For private (end-user-built) markets the owner can re-enter the wizard to
  // add an optional phase. Compute which phases are missing from the feature
  // categories so we can show targeted placeholders.
  const isOwner = !!(market?.ownerUserId && user?.id === market.ownerUserId);
  const showOwnerControls = isOwner && market?.visibility === "private";
  const canManageVendors = isAdmin || showOwnerControls;

  // If the URL contains a UUID instead of a slug, redirect to the slug URL.
  // This keeps search engines from indexing duplicate UUID-based URLs.
  useEffect(() => {
    if (!market || !marketId) return;
    if (!UUID_RE.test(marketId)) return;
    const slug = marketSlug(market.name);
    if (slug) navigate(`/markets/${slug}`, { replace: true });
  }, [market, marketId]);

  // Per-page SEO: update canonical / title / og tags once the market name is known.
  const cleanMarketTitle = market?.name.replace(/^ITMAP for /i, "") ?? "";
  useSeo(market ? {
    title: `${cleanMarketTitle} — Vendor Intelligence | ITMAP.ai`,
    description: (market as any).shortDescription || market.description ||
      `Independent vendor rankings, feature evaluations, and market analysis for ${cleanMarketTitle}. Compare vendors on ITMAP.ai.`,
    path: `/markets/${marketId}`,
  } : { title: "ITMAP.ai — Enterprise IT Vendor Intelligence", path: `/markets/${marketId ?? ""}` });

  // Track market view + dwell time once the market resolves.
  useEffect(() => {
    if (!resolvedId || !market) return;
    track("market_viewed", { marketId: resolvedId, metadata: { name: market.name } });
    const endDwell = trackDwell({ marketId: resolvedId });
    return endDwell;
  }, [resolvedId, market?.id]);

  // Tab switches are meaningful intent signals (e.g. opening News).
  useEffect(() => {
    if (!resolvedId) return;
    if (activeTab === "news") {
      track("news_viewed", { marketId: resolvedId, metadata: { tab: activeTab } });
    } else {
      track("filter_applied", { marketId: resolvedId, metadata: { tab: activeTab } });
    }
  }, [activeTab, resolvedId]);

  // Inline label-position editor state for the Vendor Evaluation chart
  const [editingLabels, setEditingLabels] = useState(false);
  const [pendingLabelPositions, setPendingLabelPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
  const [savingLabels, setSavingLabels] = useState(false);

  const handleLabelPositionChange = (vendorId: string, x: number, y: number) => {
    setPendingLabelPositions(prev => ({ ...prev, [vendorId]: { x, y } }));
  };

  const handleSaveLabelPositions = async () => {
    if (!marketId || Object.keys(pendingLabelPositions).length === 0) {
      setEditingLabels(false);
      return;
    }
    setSavingLabels(true);
    try {
      await Promise.all(
        Object.entries(pendingLabelPositions).map(([vendorId, pos]) =>
          apiRequest("/api/label-positions", "POST", {
            vendorId,
            marketId: resolvedId ?? marketId,
            labelX: pos.x,
            labelY: pos.y,
          })
        )
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/markets", resolvedId, "label-positions"] });
      toast({
        title: "Saved",
        description: `Updated ${Object.keys(pendingLabelPositions).length} label position(s).`,
      });
      setPendingLabelPositions({});
      setEditingLabels(false);
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Could not save label positions.",
        variant: "destructive",
      });
    } finally {
      setSavingLabels(false);
    }
  };

  const handleCancelLabelEdit = () => {
    setPendingLabelPositions({});
    setEditingLabels(false);
  };
  const { data: featureCategories = [] } = useQuery<any[]>({
    queryKey: ["/api/markets", resolvedId, "feature-categories"],
    enabled: !!resolvedId && showOwnerControls,
  });
  const hasProductPhase = featureCategories.some((c: any) =>
    c.isEcosystem === false || (!c.isEcosystem && !/(ecosystem|integration|partnership|third-party|isv)/i.test(c.name)));
  const hasEcosystemPhase = featureCategories.some((c: any) =>
    c.isEcosystem === true || (c.isEcosystem !== false && /(ecosystem|integration|partnership|third-party|isv)/i.test(c.name)));
  const { data: myJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/market-builder/jobs"],
    enabled: showOwnerControls,
  });
  const originatingJob = myJobs.find((j: any) => j.marketId === marketId);
  const wizardLink = originatingJob ? `/me/market-builder?job=${originatingJob.id}` : "/me/market-builder";

  const PhasePlaceholder = ({ phase }: { phase: "Product" | "Ecosystem" }) => (
    <div className="rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 text-center">
      <Sparkles className="h-8 w-8 text-blue-500 mx-auto mb-3" />
      <p className="font-semibold text-gray-900 mb-1">{phase} phase not added yet</p>
      <p className="text-sm text-gray-600 mb-4">
        This market was published without the {phase.toLowerCase()} phase. Add it in the Market Builder to populate this section.
      </p>
      <Link href={wizardLink}>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
          Add {phase} phase
        </Button>
      </Link>
    </div>
  );

  const handleGenerateFullReport = async (selectedVendorIds: string[]) => {
    setIsGenerating(true);
    for (const vid of selectedVendorIds) {
      track("vendor_selected", { marketId: resolvedId ?? marketId, vendorId: vid, metadata: { context: "report" } });
    }
    try {
      const response = await apiRequest(
        `/api/markets/${resolvedId ?? marketId}/generate-full-pdf-report`,
        "POST",
        { vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined }
      );

      if (!response.ok) {
        throw new Error("Failed to generate report");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanMarketName = market?.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      a.download = `ITMAP for ${cleanMarketName}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Full market report generated successfully",
      });

      setShowVendorModal(false);
    } catch (error) {
      console.error("Error generating full report:", error);
      toast({
        title: "Error",
        description: "Failed to generate full report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSummary = async (selectedVendorIds: string[]) => {
    setIsGeneratingSummary(true);
    for (const vid of selectedVendorIds) {
      track("vendor_selected", { marketId: resolvedId ?? marketId, vendorId: vid, metadata: { context: "summary" } });
    }
    try {
      const response = await apiRequest(
        `/api/markets/${resolvedId ?? marketId}/generate-summary-pdf`,
        "POST",
        { vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined }
      );

      if (!response.ok) {
        throw new Error("Failed to generate summary");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanMarketName = market?.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      a.download = `ITMAP Summary for ${cleanMarketName}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Summary report generated successfully",
      });

      setShowSummaryModal(false);
    } catch (error) {
      console.error("Error generating summary report:", error);
      toast({
        title: "Error",
        description: "Failed to generate summary report",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading Market</h1>
          <p className="text-gray-600">Unable to fetch market details. Please try again later.</p>
          <Link href="/markets">
            <Button className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Markets
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div 
          className={`bg-white rounded-xl shadow-sm ${isMobile ? 'p-4' : 'p-6'}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <LoadingSpinner size="sm" />
              <div>
                <Skeleton className="h-8 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          
          <Tabs defaultValue="vendor-evaluation" className="w-full">
            <TabsList className={`${isMobile ? 'inline-flex overflow-x-auto scrollbar-hide w-full justify-start' : 'grid w-full grid-cols-4'}`}>
              <TabsTrigger value="vendor-evaluation" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
                {isMobile ? 'Vendor Eval' : 'Vendor Evaluation'}
              </TabsTrigger>
              <TabsTrigger value="support-matrix" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
                {isMobile ? 'Product Eval' : 'Product Evaluation'}
              </TabsTrigger>
              <TabsTrigger value="ecosystem-support" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
                {isMobile ? 'Ecosystem' : 'Ecosystem Support'}
              </TabsTrigger>
              {/* Hidden for now - will be enabled later */}
              {/* <TabsTrigger value="generate-reports" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
                {isMobile ? 'Reports' : 'Generate Reports'}
              </TabsTrigger> */}
              <TabsTrigger value="research-methodology" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
                {isMobile ? 'Method' : 'Methodology'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vendor-evaluation" className="mt-6">
              <ChartLoading />
            </TabsContent>

            <TabsContent value="support-matrix" className="mt-6">
              <SkeletonCard lines={6} className="h-80" />
            </TabsContent>

            {/* Hidden for now - will be enabled later */}
            {/* <TabsContent value="generate-reports" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <SkeletonCard lines={2} />
                <SkeletonCard lines={2} />
                <SkeletonCard lines={2} />
              </div>
            </TabsContent> */}

            <TabsContent value="research-methodology" className="mt-6">
              <SkeletonCard lines={8} className="h-96" />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Market Not Found</h1>
          <p className="text-gray-600">The requested market could not be found.</p>
          <Link href="/markets">
            <Button className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Markets
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isFreeMarket) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back nav */}
        <div className="mb-6">
          <Link href="/markets">
            <button className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> All Markets
            </button>
          </Link>
        </div>

        {/* Market header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-xl shadow-sm p-6 mb-6"
        >
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{market.name}</h1>
          {market.description && (
            <p className="text-gray-600 leading-relaxed max-w-3xl">{market.description}</p>
          )}
          {market.category && (
            <span className="mt-3 inline-block text-xs font-medium bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              {market.category}
            </span>
          )}
        </motion.div>

        {/* Vendor preview grid */}
        {vendors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white rounded-xl shadow-sm p-6 mb-6"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Vendors tracked in this market
              <span className="ml-2 text-sm font-normal text-slate-400">({vendors.length})</span>
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Sign in for vendor scores, feature matrices, quadrant positioning, and research reports.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {vendors.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50 text-sm text-slate-700 font-medium truncate"
                >
                  <div className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />
                  <span className="truncate">{v.name}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Auth CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center"
        >
          <div className="w-12 h-12 bg-slate-700 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="h-5 w-5 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Full access is free</h3>
          <p className="text-slate-400 mb-6 max-w-sm mx-auto leading-relaxed text-sm">
            Create a free account to unlock vendor scores, feature evaluation matrices, quadrant charts, news analysis, and downloadable PDF reports.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-8 w-full sm:w-auto">
                Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" className="border-white/20 text-slate-300 hover:text-white hover:border-white/40 bg-transparent w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <motion.div 
        className={`bg-white rounded-xl shadow-sm ${isMobile ? 'p-4' : 'p-6'}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <FadeInSection className="mb-6 space-y-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className={`font-bold text-gray-900 ${isMobile ? 'text-xl' : 'text-2xl'}`}>{market.name}</h2>
            <p className={`text-gray-600 mt-1 ${isMobile ? 'text-sm' : ''}`}>{market.description}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className={`flex flex-wrap gap-2 ${isMobile ? 'justify-center' : ''}`}
          >
            <Link href="/markets">
              <Button variant="outline" size={isMobile ? "sm" : "default"}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {isMobile ? 'Back' : 'Back to Markets'}
              </Button>
            </Link>
          </motion.div>
        </FadeInSection>

        {(() => {
          const evaluationsItems = [
            { value: "vendor-evaluation", label: "Vendor Evaluation" },
            { value: "support-matrix", label: "Product Evaluation" },
            { value: "ecosystem-support", label: "Ecosystem Support" },
          ];
          const intelligenceItems: { value: string; label: string; locked?: boolean }[] = [
            { value: "news", label: "News", locked: !hasFeature("news") },
            ...(isAuthenticated ? [{ value: "intelligence-feed", label: "Intelligence Feed", locked: !hasFeature("intelligence_feed") }] : []),
            { value: "new-players", label: "New Players" },
            ...(canManageVendors ? [{ value: "vendors", label: "Vendor Newsroom URLs" }] : []),
          ];
          const researchReportsLocked = !hasFeature("research_reports");
          const isInGroup = (items: { value: string }[]) => items.some(i => i.value === activeTab);
          const activeChildLabel = (items: { value: string; label: string }[]) =>
            items.find(i => i.value === activeTab)?.label;

          const groupTriggerClass = (active: boolean) =>
            cn(
              "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              isMobile && "flex-shrink-0 px-2 text-[10px]"
            );

          return (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={isMobile ? 'inline-flex overflow-x-auto w-full justify-start' : 'inline-flex w-auto'}>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={groupTriggerClass(isInGroup(evaluationsItems))}
                    data-testid="tab-group-evaluations"
                  >
                    {isInGroup(evaluationsItems) ? (isMobile ? activeChildLabel(evaluationsItems) : `Evaluations: ${activeChildLabel(evaluationsItems)}`) : 'Evaluations'}
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {evaluationsItems.map(item => (
                      <DropdownMenuItem
                        key={item.value}
                        onSelect={() => setActiveTab(item.value)}
                        className={cn(activeTab === item.value && "bg-accent text-accent-foreground")}
                        data-testid={`tab-${item.value}`}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {!isBuyerUser && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={groupTriggerClass(isInGroup(intelligenceItems))}
                      data-testid="tab-group-intelligence"
                    >
                      {isInGroup(intelligenceItems) ? (isMobile ? activeChildLabel(intelligenceItems) : `Intelligence: ${activeChildLabel(intelligenceItems)}`) : 'Intelligence'}
                      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {intelligenceItems.map(item => (
                        item.locked ? (
                          <LockedFeatureTooltip key={item.value}>
                            <div
                              className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground/50 cursor-not-allowed select-none"
                              data-testid={`tab-${item.value}-locked`}
                            >
                              <span>{item.label}</span>
                              <Lock className="h-3 w-3" />
                            </div>
                          </LockedFeatureTooltip>
                        ) : (
                          <DropdownMenuItem
                            key={item.value}
                            onSelect={() => setActiveTab(item.value)}
                            className={cn(activeTab === item.value && "bg-accent text-accent-foreground")}
                            data-testid={`tab-${item.value}`}
                          >
                            {item.label}
                          </DropdownMenuItem>
                        )
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {researchReportsLocked ? (
                  <LockedFeatureTooltip>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed select-none",
                        isMobile && "flex-shrink-0 px-2 text-[10px]"
                      )}
                      data-testid="tab-research-reports-locked"
                    >
                      Reports
                      <Lock className="h-3 w-3" />
                    </span>
                  </LockedFeatureTooltip>
                ) : (
                  <TabsTrigger value="research-reports" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-research-reports">
                    Reports
                  </TabsTrigger>
                )}
                <TabsTrigger value="research-methodology" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-methodology">
                  {isMobile ? 'Method' : 'Methodology'}
                </TabsTrigger>
                {isAuthenticated && (market?.visibility !== "private" || market?.ownerUserId === user?.id || isAdmin) && (
                  hasFeature("rfp") ? (
                    <button
                      className={cn(
                        "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-muted-foreground hover:text-foreground",
                        isMobile && "flex-shrink-0 px-2 text-[10px]"
                      )}
                      disabled={createRfpMutation.isPending}
                      data-testid="tab-generate-rfp"
                      onClick={() => {
                        track("rfp_clicked", { marketId: resolvedId ?? marketId, metadata: { marketName: market.name } });
                        createRfpMutation.mutate({ marketId: market.id, marketName: market.name });
                      }}
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      {createRfpMutation.isPending ? "Starting…" : (isMobile ? 'RFP' : 'Generate RFP')}
                    </button>
                  ) : (
                    <LockedFeatureTooltip>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed select-none",
                          isMobile && "flex-shrink-0 px-2 text-[10px]"
                        )}
                        data-testid="tab-generate-rfp-locked"
                      >
                        <Lock className="h-3 w-3" />
                        {isMobile ? 'RFP' : 'Generate RFP'}
                      </span>
                    </LockedFeatureTooltip>
                  )
                )}
              </TabsList>

          <TabsContent value="vendor-evaluation" className="mt-6">
            {canManageVendors && (
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm text-gray-600">
                  {editingLabels ? (
                    <span className="inline-flex items-center gap-1.5 text-blue-700">
                      <Move className="h-3.5 w-3.5" />
                      Drag any vendor name to reposition it.
                      {Object.keys(pendingLabelPositions).length > 0 && (
                        <span className="ml-1 font-medium">
                          {Object.keys(pendingLabelPositions).length} unsaved change(s)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span>Labels look cluttered? Adjust them.</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingLabels ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelLabelEdit}
                        disabled={savingLabels}
                        data-testid="button-cancel-label-edit"
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveLabelPositions}
                        disabled={savingLabels || Object.keys(pendingLabelPositions).length === 0}
                        data-testid="button-save-label-positions"
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {savingLabels ? "Saving…" : "Save Positions"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingLabels(true)}
                      data-testid="button-edit-labels"
                    >
                      <Move className="h-3.5 w-3.5 mr-1" /> Edit Label Positions
                    </Button>
                  )}
                </div>
              </div>
            )}
            <MagicQuadrant
              key={`mq-${editingLabels ? "edit" : "view"}`}
              marketId={resolvedId!}
              marketName={market.name}
              marketType={(market as any).marketType ?? "mature"}
              enableDrag={editingLabels}
              onLabelPositionChange={editingLabels ? handleLabelPositionChange : undefined}
              quadrantSettings={{
                dividerY: market.quadrantDividerY != null ? Number(market.quadrantDividerY) : 50,
                topLabel: market.quadrantTopLabel ?? "ITMAP Leaders",
                colorTheme: market.quadrantColorTheme ?? "dark-blue-gold",
              }}
            />
          </TabsContent>

          <TabsContent value="support-matrix" className="mt-6">
            {showOwnerControls && !hasProductPhase
              ? <PhasePlaceholder phase="Product" />
              : <SupportMatrix marketId={resolvedId!} />}
          </TabsContent>

          <TabsContent value="ecosystem-support" className="mt-6">
            {showOwnerControls && !hasEcosystemPhase
              ? <PhasePlaceholder phase="Ecosystem" />
              : <EcosystemSupport marketId={resolvedId!} />}
          </TabsContent>

          <TabsContent value="research-methodology" className="mt-6">
            <ResearchMethodology marketId={resolvedId!} />
          </TabsContent>

          <TabsContent value="new-players" className="mt-6">
            <NewPlayers marketId={resolvedId!} />
          </TabsContent>

          <TabsContent value="research-reports" className="mt-6">
            <div className="flex flex-wrap gap-2 mb-5">
              <Button
                onClick={() => setShowVendorModal(true)}
                variant="default"
                size={isMobile ? "sm" : "default"}
                data-testid="button-generate-full-report"
              >
                <FileDown className="mr-2 h-4 w-4" />
                {isMobile ? 'Report' : 'Generate Reports'}
              </Button>
              <Button
                onClick={() => setShowSummaryModal(true)}
                variant="outline"
                size={isMobile ? "sm" : "default"}
                className="border-violet-500/50 text-violet-700 hover:bg-violet-50"
                data-testid="button-download-summary"
              >
                <FileDown className="mr-2 h-4 w-4" />
                {isMobile ? 'Summary' : 'Download Summary'}
              </Button>
            </div>
            <ResearchReports marketId={resolvedId!} />
          </TabsContent>

          <TabsContent value="news" className="mt-6">
            <MarketNews marketId={resolvedId!} />
          </TabsContent>

          {canManageVendors && (
            <TabsContent value="vendors" className="mt-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Vendor Newsroom URLs</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Add a press / newsroom page for each vendor — the daily ingestion at 7:00 AM UTC will pull their news automatically.
                  </p>
                </div>
                <Link href={`/me/markets/${resolvedId ?? marketId}/vendors`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    Open dedicated page <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
              <VendorNewsroomManager marketId={resolvedId!} variant="compact" />
            </TabsContent>
          )}

          {isAuthenticated && (
            <TabsContent value="intelligence-feed" className="mt-6">
              <IntelligenceFeed marketId={resolvedId!} vendors={vendors} />
            </TabsContent>
          )}

            </Tabs>
          );
        })()}
      </motion.div>

      {/* Floating AI Chat button — available from every tab */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white shadow-lg shadow-violet-500/30 flex items-center justify-center transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2"
        aria-label="Open AI Chat"
        data-testid="button-open-ai-chat"
      >
        <MessageSquare className="h-6 w-6" />
      </button>

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-cyan-600" />
              AI Chat — {market.name}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 bg-white dark:bg-gray-900">
            <Chat marketId={resolvedId!} />
          </div>
        </SheetContent>
      </Sheet>

      <VendorSelectionModal
        open={showVendorModal}
        onOpenChange={setShowVendorModal}
        vendors={vendors}
        onGenerate={handleGenerateFullReport}
        title="Generate Full Market Report"
        description="Select vendors to include in the full market report (all sections combined)"
        isGenerating={isGenerating}
      />

      <VendorSelectionModal
        open={showSummaryModal}
        onOpenChange={setShowSummaryModal}
        vendors={vendors}
        onGenerate={handleGenerateSummary}
        title="Download Summary Report"
        description="Select vendors for a short AI-generated summary (~2-3 pages per vendor). This may take a moment while the AI condenses each section."
        isGenerating={isGeneratingSummary}
      />
    </div>
  );
}
