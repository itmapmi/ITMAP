import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, FileDown } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import MagicQuadrant from "@/components/magic-quadrant";
import SupportMatrix from "@/components/support-matrix";
import EcosystemSupport from "@/components/ecosystem-support";
import GenerateReports from "@/components/generate-reports";
import ResearchMethodology from "@/components/research-methodology";
import { NewPlayers } from "@/components/new-players";
import { VendorSelectionModal } from "@/components/vendor-selection-modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Market, Vendor } from "@shared/schema";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";
import { ChartLoading, LoadingSpinner, SkeletonCard } from "@/components/ui/loading-animations";

export default function MarketDetails() {
  const [match, params] = useRoute("/markets/:marketId");
  const marketId = params?.marketId;
  const isMobile = useIsMobile();
  const { toast } = useToast();

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
      a.download = `${market?.name.replace(/[^a-zA-Z0-9\s\-]/g, '')}_Full_Report.pdf`;
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
              {isMobile ? 'Report' : 'Generate Full Report'}
            </Button>
            <Link href="/markets">
              <Button variant="outline" size={isMobile ? "sm" : "default"}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {isMobile ? 'Back' : 'Back to Markets'}
              </Button>
            </Link>
          </motion.div>
        </FadeInSection>

        <Tabs defaultValue="vendor-evaluation" className="w-full">
          <TabsList className={`${isMobile ? 'inline-flex overflow-x-auto scrollbar-hide w-full justify-start' : 'grid w-full grid-cols-5'}`}>
            <TabsTrigger value="vendor-evaluation" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''} data-testid="tab-vendor-evaluation">
              {isMobile ? 'Vendor Eval' : 'Vendor Evaluation'}
            </TabsTrigger>
            <TabsTrigger value="support-matrix" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''} data-testid="tab-support-matrix">
              {isMobile ? 'Product Eval' : 'Product Evaluation'}
            </TabsTrigger>
            <TabsTrigger value="ecosystem-support" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''} data-testid="tab-ecosystem-support">
              {isMobile ? 'Ecosystem' : 'Ecosystem Support'}
            </TabsTrigger>
            {/* Hidden for now - will be enabled later */}
            {/* <TabsTrigger value="generate-reports" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''}>
              {isMobile ? 'Reports' : 'Generate Reports'}
            </TabsTrigger> */}
            <TabsTrigger value="research-methodology" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''} data-testid="tab-methodology">
              {isMobile ? 'Method' : 'Methodology'}
            </TabsTrigger>
            <TabsTrigger value="new-players" className={isMobile ? 'flex-shrink-0 px-3 text-xs' : ''} data-testid="tab-new-players">
              {isMobile ? 'New Players' : 'New Players'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vendor-evaluation" className="mt-6">
            <MagicQuadrant marketId={marketId!} marketName={market.name} />
          </TabsContent>

          <TabsContent value="support-matrix" className="mt-6">
            <SupportMatrix marketId={marketId!} />
          </TabsContent>

          <TabsContent value="ecosystem-support" className="mt-6">
            <EcosystemSupport marketId={marketId!} />
          </TabsContent>

          {/* Hidden for now - will be enabled later */}
          {/* <TabsContent value="generate-reports" className="mt-6">
            <GenerateReports marketId={marketId!} />
          </TabsContent> */}

          <TabsContent value="research-methodology" className="mt-6">
            <ResearchMethodology marketId={marketId!} />
          </TabsContent>

          <TabsContent value="new-players" className="mt-6">
            <NewPlayers marketId={marketId!} />
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
