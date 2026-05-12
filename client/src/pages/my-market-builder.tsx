import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Sparkles, Lock, Key, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketBuilderWizard } from "@/components/admin/market-builder-wizard";
import { MyPromptsRepository } from "@/components/me/my-prompts-repository";

type TabKey = "builder" | "prompts";

function readTabFromUrl(): TabKey {
  const search = typeof window !== "undefined" ? window.location.search : "";
  return new URLSearchParams(search).get("tab") === "prompts" ? "prompts" : "builder";
}

export default function MyMarketBuilderPage() {
  // URL-driven tab so deep-links like ?tab=prompts (used by the prompt
  // selector's "Manage My Prompts" link) auto-open the right view.
  // We can't rely on wouter's useLocation here — it only re-renders on
  // pathname changes, not query-string changes, which is why clicking
  // the tab used to do nothing visible.
  const [tab, setTab] = useState<TabKey>(() => readTabFromUrl());

  useEffect(() => {
    const onPop = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onTabChange = (next: string) => {
    const tabKey: TabKey = next === "prompts" ? "prompts" : "builder";
    setTab(tabKey);
    const search = new URLSearchParams(window.location.search);
    if (tabKey === "builder") search.delete("tab"); else search.set("tab", "prompts");
    const qs = search.toString();
    const url = `/me/market-builder${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-blue-600" />
            My Market Builder
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Build private market research using your own LLM API keys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/me/reports">
            <a className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50">
              <FileText className="h-3.5 w-3.5" /> My Reports
            </a>
          </Link>
          <Link href="/me/settings/llm-keys">
            <a className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50">
              <Key className="h-3.5 w-3.5" /> LLM Keys
            </a>
          </Link>
        </div>
      </div>
      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="prompts">My Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="builder" className="mt-6">
          <MarketBuilderWizard mode="user" />
        </TabsContent>
        <TabsContent value="prompts" className="mt-6">
          <MyPromptsRepository />
        </TabsContent>
      </Tabs>
    </div>
  );
}
