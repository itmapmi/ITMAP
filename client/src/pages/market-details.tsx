import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, FileDown, Lock, ArrowRight, ExternalLink, Move, Save, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { FREE_MARKET_ID } from "@/pages/markets";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import MagicQuadrant from "@/components/magic-quadrant";
import SupportMatrix from "@/components/support-matrix";
import EcosystemSupport from "@/components/ecosystem-support";
import GenerateReports from "@/components/generate-reports";
import ResearchMethodology from "@/components/research-methodology";
import { NewPlayers } from "@/components/new-players";
import { MarketNews } from "@/components/market-news";
import { VendorSelectionModal } from "@/components/vendor-selection-modal";
import { Chat } from "@/components/Chat";
import { IntelligenceFeed } from "@/components/intelligence-feed";
import { VendorNewsroomManager } from "@/components/vendor-newsroom-manager";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { getErrorMessage, isMissingLlmKeyError } from "@/lib/rfp-errors";
import { useLocation } from "wouter";
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

export default function MarketDetails() {
  const [match, params] = useRoute("/markets/:marketId");
  const marketId = params?.marketId;
  const isMobile = useIsMobile();
  const { isAuthenticated, user, isAdmin } = useAuth();
  const createRfpMutation = useCreateRfpForMarket();
  const { toast } = useToast();
  const isFreeMarket = marketId === FREE_MARKET_ID;

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: market, isLoading, error } = useQuery<Market>({
    queryKey: ["/api/markets", marketId],
    enabled: !!marketId,
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
    enabled: !!marketId,
  });

  // For private (end-user-built) markets the owner can re-enter the wizard to
  // add an optional phase. Compute which phases are missing from the feature
  // categories so we can show targeted placeholders.
  const isOwner = !!(market?.ownerUserId && user?.id === market.ownerUserId);
  const showOwnerControls = isOwner && market?.visibility === "private";
  const canManageVendors = isAdmin || showOwnerControls;

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
            marketId,
            labelX: pos.x,
            labelY: pos.y,
          })
        )
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "label-positions"] });
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
    queryKey: ["/api/markets", marketId, "feature-categories"],
    enabled: !!marketId && showOwnerControls,
  });
  const hasProductPhase = featureCategories.some((c: any) =>
    !/(ecosystem|integration|partnership|third-party|isv)/i.test(c.name));
  const hasEcosystemPhase = featureCategories.some((c: any) =>
    /(ecosystem|integration|partnership|third-party|isv)/i.test(c.name));
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
    try {
      const response = await apiRequest(
        `/api/markets/${marketId}/generate-full-pdf-report`,
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
      a.download = `Spectio for ${cleanMarketName}.pdf`;
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
      <div className="min-h-[80vh] bg-[#1e2130] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-slate-800 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="h-7 w-7 text-slate-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">{market.name}</h2>
          <p className="text-slate-400 mb-8 leading-relaxed">
            This market research is available to registered users. Sign in or create a free account to access vendor scores, feature matrices, news analysis, and downloadable reports.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-8 w-full sm:w-auto">
                Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white bg-transparent w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>
          <Link href="/markets">
            <button className="mt-6 text-sm text-slate-600 hover:text-slate-400 flex items-center gap-1 mx-auto transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Markets
            </button>
          </Link>
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
        <FadeInSection className={`${isMobile ? 'space-y-4' : 'flex items-center justify-between'} mb-6`}>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className={`font-bold text-gray-900 ${isMobile ? 'text-xl' : 'text-2xl'}`}>{market.name}</h2>
            <p className={`text-gray-600 ${isMobile ? 'text-sm' : ''}`}>{market.description}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className={isMobile ? 'flex gap-2 justify-center' : 'flex gap-2'}
          >
            <Button
              onClick={() => setShowVendorModal(true)}
              variant="default"
              size={isMobile ? "sm" : "default"}
              data-testid="button-generate-full-report"
            >
              <FileDown className="mr-2 h-4 w-4" />
              {isMobile ? 'Report' : 'Generate Reports'}
            </Button>
            {isAuthenticated && (market?.visibility !== "private" || market?.ownerUserId === user?.id || isAdmin) && (
              <Button
                variant="outline"
                size={isMobile ? "sm" : "default"}
                className="border-cyan-500/50 text-cyan-700 hover:bg-cyan-50"
                data-testid="button-generate-rfp"
                disabled={createRfpMutation.isPending}
                onClick={() => createRfpMutation.mutate({ marketId: market.id, marketName: market.name })}
              >
                <FileDown className="mr-2 h-4 w-4" />
                {createRfpMutation.isPending ? "Starting…" : (isMobile ? 'RFP' : 'Generate RFP')}
              </Button>
            )}
            <Link href="/markets">
              <Button variant="outline" size={isMobile ? "sm" : "default"}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {isMobile ? 'Back' : 'Back to Markets'}
              </Button>
            </Link>
          </motion.div>
        </FadeInSection>

        <Tabs defaultValue="vendor-evaluation" className="w-full">
          <TabsList className={`${isMobile ? 'inline-flex overflow-x-auto w-full justify-start' : 'flex flex-wrap w-full'}`}>
            <TabsTrigger value="vendor-evaluation" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-vendor-evaluation">
              {isMobile ? 'Vendor Eval' : 'Vendor Evaluation'}
            </TabsTrigger>
            <TabsTrigger value="support-matrix" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-support-matrix">
              {isMobile ? 'Product Eval' : 'Product Evaluation'}
            </TabsTrigger>
            <TabsTrigger value="ecosystem-support" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-ecosystem-support">
              {isMobile ? 'Ecosystem' : 'Ecosystem Support'}
            </TabsTrigger>
            <TabsTrigger value="research-methodology" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-methodology">
              {isMobile ? 'Method' : 'Methodology'}
            </TabsTrigger>
            <TabsTrigger value="new-players" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-new-players">
              {isMobile ? 'Players' : 'New Players'}
            </TabsTrigger>
            <TabsTrigger value="news" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-news">
              News
            </TabsTrigger>
            {canManageVendors && (
              <TabsTrigger value="vendors" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-vendors">
                {isMobile ? 'Vendors' : 'Vendor Newsroom URLs'}
              </TabsTrigger>
            )}
            {isAuthenticated && (
              <TabsTrigger value="intelligence-feed" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-intelligence-feed">
                {isMobile ? 'Signals' : 'Intelligence Feed'}
              </TabsTrigger>
            )}
            <TabsTrigger value="ai-chat" className={isMobile ? 'flex-shrink-0 px-2 text-[10px]' : 'whitespace-nowrap'} data-testid="tab-ai-chat">
              {isMobile ? 'AI Chat' : 'AI Chat'}
            </TabsTrigger>
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
              marketId={marketId!}
              marketName={market.name}
              enableDrag={editingLabels}
              onLabelPositionChange={editingLabels ? handleLabelPositionChange : undefined}
            />
          </TabsContent>

          <TabsContent value="support-matrix" className="mt-6">
            {showOwnerControls && !hasProductPhase
              ? <PhasePlaceholder phase="Product" />
              : <SupportMatrix marketId={marketId!} />}
          </TabsContent>

          <TabsContent value="ecosystem-support" className="mt-6">
            {showOwnerControls && !hasEcosystemPhase
              ? <PhasePlaceholder phase="Ecosystem" />
              : <EcosystemSupport marketId={marketId!} />}
          </TabsContent>

          <TabsContent value="research-methodology" className="mt-6">
            <ResearchMethodology marketId={marketId!} />
          </TabsContent>

          <TabsContent value="new-players" className="mt-6">
            <NewPlayers marketId={marketId!} />
          </TabsContent>

          <TabsContent value="news" className="mt-6">
            <MarketNews marketId={marketId!} />
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
                <Link href={`/me/markets/${marketId}/vendors`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    Open dedicated page <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
              <VendorNewsroomManager marketId={marketId!} variant="compact" />
            </TabsContent>
          )}

          {isAuthenticated && (
            <TabsContent value="intelligence-feed" className="mt-6">
              <IntelligenceFeed marketId={marketId!} vendors={vendors} />
            </TabsContent>
          )}

          <TabsContent value="ai-chat" className="mt-6">
            <div className="bg-white dark:bg-gray-900 rounded-lg border h-[600px]">
              <Chat marketId={marketId!} />
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>

      <VendorSelectionModal
        open={showVendorModal}
        onOpenChange={setShowVendorModal}
        vendors={vendors}
        onGenerate={handleGenerateFullReport}
        title="Generate Full Market Report"
        description="Select vendors to include in the full market report (all sections combined)"
        isGenerating={isGenerating}
      />
    </div>
  );
}
