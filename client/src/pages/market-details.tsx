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
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-5 w-96" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
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
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{market.name}</h2>
            <p className="text-gray-600">{market.description}</p>
          </div>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Markets
            </Button>
          </Link>
        </div>

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
      </div>
    </div>
  );
}
