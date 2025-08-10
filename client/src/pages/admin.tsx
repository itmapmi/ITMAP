import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MarketManagement from "@/components/admin/market-management";
import VendorManagement from "@/components/admin/vendor-management";
import CriteriaManagement from "@/components/admin/criteria-management";
import NewsAnalysis from "@/components/admin/news-analysis";

export default function Admin() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Admin Portal</h2>
        <p className="text-gray-600">Manage markets, vendors, and analysis criteria</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <Tabs defaultValue="market-management" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="market-management">Market Management</TabsTrigger>
            <TabsTrigger value="vendor-management">Vendor Management</TabsTrigger>
            <TabsTrigger value="criteria-management">Criteria Management</TabsTrigger>
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

          <TabsContent value="news-analysis" className="mt-6">
            <NewsAnalysis />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
