import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";
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
import { NewsAdmin } from "@/components/admin/news-admin";
import { ApiKeysAdmin } from "@/components/admin/api-keys-admin";
import { AiSuggestionsAdmin } from "@/components/admin/ai-suggestions-admin";
import { SignalFeedAdmin } from "@/components/admin/signal-feed-admin";
import { UserMarketsAdmin } from "@/components/admin/user-markets-admin";
import { UserRfpsAdmin } from "@/components/admin/user-rfps-admin";
import DatasheetsAdmin from "@/components/admin/datasheets-admin";
import { UserAccessAdmin } from "@/components/admin/user-access-admin";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Wand2, ArrowRight, Radar } from "lucide-react";
import { FadeInSection } from "@/components/ui/animated-card";

function PendingBadge() {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/ai-suggestions/count"],
    refetchInterval: 60000,
  });
  const count = data?.count ?? 0;
  if (!count) return null;
  return (
    <span className="rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
      {count}
    </span>
  );
}

export default function Admin() {
  const [activeTab, setActiveTab] = useState<string>("market-management");
  const [pendingEditVendor, setPendingEditVendor] = useState<{ id: string; marketId: string } | null>(null);
  const [pendingSignalFeedVendor, setPendingSignalFeedVendor] = useState<string | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <FadeInSection className="mb-8 flex items-start justify-between">
        <div>
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
        </div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Button
            variant="outline"
            onClick={() => window.open("/api/download/functional-spec", "_blank")}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Functional Spec (.docx)
          </Button>
        </motion.div>
      </FadeInSection>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
      >
        <Link href="/market-builder">
          <a className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 hover:bg-blue-100 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-600 p-2">
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-blue-900 text-sm">AI Market Builder</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Generate a complete market — vendors, criteria, features, scores and support levels — from a description
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-blue-400 group-hover:text-blue-600 transition-colors shrink-0" />
          </a>
        </Link>
      </motion.div>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <Link href="/lead-gen">
          <a className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 hover:bg-violet-100 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 p-2">
                <Radar className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-violet-900 text-sm">Lead-Gen Activity Intelligence</p>
                <p className="text-xs text-violet-600 mt-0.5">
                  Track buyer activity and surface high-intent leads with deterministic scoring, timelines and exports
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-violet-400 group-hover:text-violet-600 transition-colors shrink-0" />
          </a>
        </Link>
      </motion.div>

      <motion.div
        className="bg-white rounded-xl shadow-sm p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <Tabs value={activeTab} onValueChange={(tab) => { if (tab !== "signal-feed") setPendingSignalFeedVendor(null); setActiveTab(tab); }} className="w-full">
          <TabsList className="flex w-full overflow-x-auto flex-wrap gap-0 h-auto">
            <TabsTrigger value="market-management">Markets</TabsTrigger>
            <TabsTrigger value="user-access">User Access</TabsTrigger>
            <TabsTrigger value="user-markets">User Markets</TabsTrigger>
            <TabsTrigger value="user-rfps">User RFPs</TabsTrigger>
            <TabsTrigger value="vendor-management">Vendors</TabsTrigger>
            <TabsTrigger value="new-players">New Players</TabsTrigger>
            <TabsTrigger value="news">News</TabsTrigger>
            <TabsTrigger value="ai-suggestions" className="gap-1.5">
              AI Suggestions
              <PendingBadge />
            </TabsTrigger>
            <TabsTrigger value="signal-feed">Signal Feed</TabsTrigger>
            <TabsTrigger value="criteria-management">Criteria</TabsTrigger>
            <TabsTrigger value="feature-management">Features</TabsTrigger>
            <TabsTrigger value="support-matrix">Product Eval</TabsTrigger>
            <TabsTrigger value="graphic">Graphic</TabsTrigger>
            <TabsTrigger value="import-export">Import/Export</TabsTrigger>
            <TabsTrigger value="research-reports">Reports</TabsTrigger>
            <TabsTrigger value="research-methodology">Methodology</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="datasheets">Datasheets</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          </TabsList>

          <TabsContent value="market-management" className="mt-6">
            <MarketManagement />
          </TabsContent>

          <TabsContent value="user-access" className="mt-6">
            <UserAccessAdmin />
          </TabsContent>

          <TabsContent value="user-markets" className="mt-6">
            <UserMarketsAdmin />
          </TabsContent>

          <TabsContent value="user-rfps" className="mt-6">
            <UserRfpsAdmin />
          </TabsContent>

          <TabsContent value="vendor-management" className="mt-6">
            <VendorManagement
              initialEditVendor={pendingEditVendor}
              onInitialEditConsumed={() => setPendingEditVendor(null)}
              onNavigateToSignals={(vendorId) => {
                setPendingSignalFeedVendor(vendorId);
                setActiveTab("signal-feed");
              }}
            />
          </TabsContent>

          <TabsContent value="new-players" className="mt-6">
            <NewPlayersAdmin />
          </TabsContent>

          <TabsContent value="news" className="mt-6">
            <NewsAdmin
              onNavigateToVendor={(vendorId, marketId) => {
                setPendingEditVendor({ id: vendorId, marketId });
                setActiveTab("vendor-management");
              }}
            />
          </TabsContent>

          <TabsContent value="ai-suggestions" className="mt-6">
            <AiSuggestionsAdmin />
          </TabsContent>

          <TabsContent value="signal-feed" className="mt-6">
            <SignalFeedAdmin
              initialVendorId={pendingSignalFeedVendor}
              key={pendingSignalFeedVendor ?? "signal-feed"}
            />
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

          <TabsContent value="datasheets" className="mt-6">
            <DatasheetsAdmin />
          </TabsContent>

          <TabsContent value="api-keys" className="mt-6">
            <ApiKeysAdmin />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
