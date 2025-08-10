import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MarketManagement from "@/components/admin/market-management";
import VendorManagement from "@/components/admin/vendor-management";
import CriteriaManagement from "@/components/admin/criteria-management";
import FeatureManagement from "@/components/admin/feature-management";
import NewsAnalysis from "@/components/admin/news-analysis";

export default function Admin() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Admin Portal</h2>
        <p className="text-gray-600">Manage markets, vendors, features, and analysis criteria</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <Tabs defaultValue="market-management" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="market-management">Markets</TabsTrigger>
            <TabsTrigger value="vendor-management">Vendors</TabsTrigger>
            <TabsTrigger value="criteria-management">Criteria</TabsTrigger>
            <TabsTrigger value="feature-management">Features</TabsTrigger>
            <TabsTrigger value="news-analysis">News Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="market-management" className="mt-6">
            <MarketManagement />
          </TabsContent>

          <TabsContent value="vendor-management" className="mt-6">
            <VendorManagement />
          </TabsContent>

          <TabsContent value="criteria-management" className="mt-6">
            <CriteriaManagement />
          </TabsContent>

          <TabsContent value="feature-management" className="mt-6">
            <FeatureManagement />
          </TabsContent>

          <TabsContent value="news-analysis" className="mt-6">
            <NewsAnalysis />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
