import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MarketManagement from "@/components/admin/market-management";
import VendorManagement from "@/components/admin/vendor-management";
import CriteriaManagement from "@/components/admin/criteria-management";
import { FeatureCategoryManagement } from "@/components/admin/feature-category-management";
import { SupportMatrixAdmin } from "../components/admin/support-matrix-admin";
import ImportExportAdmin from "@/components/admin/import-export-admin";
import ResearchReportsManagement from "@/components/admin/research-reports-management";
import ResearchMethodologyManagement from "@/components/admin/research-methodology-management";
import OperationsManagement from "@/components/admin/operations-management";
import GraphicManagement from "@/components/admin/graphic-management";
import { NewPlayersAdmin } from "@/components/admin/new-players-admin";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";

export default function Admin() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <FadeInSection className="mb-8">
        <motion.h2 
          className="text-3xl font-bold text-gray-900 mb-2"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          Admin Portal
        </motion.h2>
        <motion.p 
          className="text-gray-600"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
        >
          Manage markets, vendors, features, and analysis criteria
        </motion.p>
      </FadeInSection>

      <motion.div 
        className="bg-white rounded-xl shadow-sm p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <Tabs defaultValue="market-management" className="w-full">
          <TabsList className="grid w-full grid-cols-11">
            <TabsTrigger value="market-management">Markets</TabsTrigger>
            <TabsTrigger value="vendor-management">Vendors</TabsTrigger>
            <TabsTrigger value="new-players">New Players</TabsTrigger>
            <TabsTrigger value="criteria-management">Criteria</TabsTrigger>
            <TabsTrigger value="feature-management">Features</TabsTrigger>
            <TabsTrigger value="support-matrix">Product Evaluation</TabsTrigger>
            <TabsTrigger value="graphic">Graphic</TabsTrigger>
            <TabsTrigger value="import-export">Import/Export</TabsTrigger>
            <TabsTrigger value="research-reports">Reports</TabsTrigger>
            <TabsTrigger value="research-methodology">Methodology</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
          </TabsList>

          <TabsContent value="market-management" className="mt-6">
            <MarketManagement />
          </TabsContent>

          <TabsContent value="vendor-management" className="mt-6">
            <VendorManagement />
          </TabsContent>

          <TabsContent value="new-players" className="mt-6">
            <NewPlayersAdmin />
          </TabsContent>

          <TabsContent value="criteria-management" className="mt-6">
            <CriteriaManagement />
          </TabsContent>

          <TabsContent value="feature-management" className="mt-6">
            <FeatureCategoryManagement />
          </TabsContent>

          <TabsContent value="support-matrix" className="mt-6">
            <SupportMatrixAdmin />
          </TabsContent>

          <TabsContent value="graphic" className="mt-6">
            <GraphicManagement />
          </TabsContent>

          <TabsContent value="import-export" className="mt-6">
            <ImportExportAdmin />
          </TabsContent>

          <TabsContent value="research-reports" className="mt-6">
            <ResearchReportsManagement />
          </TabsContent>

          <TabsContent value="research-methodology" className="mt-6">
            <ResearchMethodologyManagement />
          </TabsContent>

          <TabsContent value="operations" className="mt-6">
            <OperationsManagement />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
