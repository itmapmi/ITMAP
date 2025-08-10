import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import MagicQuadrant from "@/components/magic-quadrant";
import VendorComparison from "@/components/vendor-comparison";
import SupportMatrix from "@/components/support-matrix";
import VendorNews from "@/components/vendor-news";
import ResearchReports from "@/components/research-reports";
import type { Market } from "@shared/schema";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";
import { ChartLoading, LoadingSpinner, SkeletonCard } from "@/components/ui/loading-animations";

export default function MarketDetails() {
  const [match, params] = useRoute("/market/:marketId");
  const marketId = params?.marketId;

  const { data: market, isLoading, error } = useQuery<Market>({
    queryKey: ["/api/markets", marketId],
    enabled: !!marketId,
  });

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading Market</h1>
          <p className="text-gray-600">Unable to fetch market details. Please try again later.</p>
          <Link href="/">
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
          className="bg-white rounded-xl shadow-sm p-6"
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
          
          <Tabs defaultValue="quadrant" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="quadrant">Magic Quadrant</TabsTrigger>
              <TabsTrigger value="comparison">Vendor Comparison</TabsTrigger>
              <TabsTrigger value="features">Support Matrix</TabsTrigger>
              <TabsTrigger value="news">Vendor News</TabsTrigger>
              <TabsTrigger value="reports">Research Reports</TabsTrigger>
            </TabsList>

            <TabsContent value="quadrant" className="mt-6">
              <ChartLoading />
            </TabsContent>

            <TabsContent value="comparison" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SkeletonCard showAvatar={true} lines={4} />
                <SkeletonCard showAvatar={true} lines={4} />
              </div>
            </TabsContent>

            <TabsContent value="features" className="mt-6">
              <SkeletonCard lines={6} className="h-80" />
            </TabsContent>

            <TabsContent value="news" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SkeletonCard showAvatar={true} lines={3} />
                <SkeletonCard showAvatar={true} lines={3} />
                <SkeletonCard showAvatar={true} lines={3} />
                <SkeletonCard showAvatar={true} lines={3} />
              </div>
            </TabsContent>

            <TabsContent value="reports" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <SkeletonCard lines={2} />
                <SkeletonCard lines={2} />
                <SkeletonCard lines={2} />
              </div>
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
          <Link href="/">
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
        className="bg-white rounded-xl shadow-sm p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <FadeInSection className="flex items-center justify-between mb-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className="text-2xl font-bold text-gray-900">{market.name}</h2>
            <p className="text-gray-600">{market.description}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Markets
              </Button>
            </Link>
          </motion.div>
        </FadeInSection>

        <Tabs defaultValue="vendor-evaluation" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="vendor-evaluation">Vendor Evaluation</TabsTrigger>
            <TabsTrigger value="vendor-news">Vendor News</TabsTrigger>
            <TabsTrigger value="support-matrix">Support Matrix</TabsTrigger>
            <TabsTrigger value="research-reports">Research Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="vendor-evaluation" className="mt-6">
            <div className="space-y-8">
              <MagicQuadrant marketId={marketId!} />
              <VendorComparison marketId={marketId!} />
            </div>
          </TabsContent>

          <TabsContent value="vendor-news" className="mt-6">
            <VendorNews marketId={marketId!} />
          </TabsContent>

          <TabsContent value="support-matrix" className="mt-6">
            <SupportMatrix marketId={marketId!} />
          </TabsContent>

          <TabsContent value="research-reports" className="mt-6">
            <ResearchReports marketId={marketId!} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
