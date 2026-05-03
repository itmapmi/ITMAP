import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketBuilderWizard } from "@/components/admin/market-builder-wizard";
import { PromptsAdmin } from "@/components/admin/prompts-admin";

export default function MarketBuilderPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/admin">
          <a className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronLeft className="h-4 w-4" />
            Back to Admin
          </a>
        </Link>
      </div>
      <Tabs defaultValue="builder" className="w-full">
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="builder" className="mt-6">
          <MarketBuilderWizard />
        </TabsContent>
        <TabsContent value="prompts" className="mt-6">
          <PromptsAdmin />
        </TabsContent>
      </Tabs>
    </div>
  );
}
