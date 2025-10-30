import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardContent } from "@/mobile/components/MobileCard";
import { MobileLoadingScreen } from "@/mobile/components/MobileLoadingSpinner";
import { MobileVendorQuadrant } from "@/mobile/components/MobileVendorQuadrant";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import SupportMatrix from "@/components/support-matrix";
import EcosystemSupport from "@/components/ecosystem-support";
import { Building2, TrendingUp, TrendingDown, ArrowLeft, Home } from "lucide-react";
import type { Market, Vendor, VendorScore, Criteria, NewsArticle } from "@shared/schema";

interface VendorWithScores extends Vendor {
  executionScore: number;
  viabilityScore: number;
}

export default function MobileMarketDetails() {
  const [, params] = useRoute("/mobile/markets/:marketId");
  const marketId = params?.marketId;

  const { data: market, isLoading: marketLoading } = useQuery<Market>({
    queryKey: ["/api/markets", marketId],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
    enabled: !!marketId,
  });

  const { data: scores } = useQuery<VendorScore[]>({
    queryKey: ["/api/markets", marketId, "scores"],
    enabled: !!marketId,
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/markets", marketId, "criteria"],
    enabled: !!marketId,
  });

  if (marketLoading || !market) {
    return <MobileLoadingScreen message="Loading market details..." />;
  }

  const executionCriteria = criteria?.filter(c => c.category === "execution") || [];
  const viabilityCriteria = criteria?.filter(c => c.category === "viability") || [];

  const vendorsWithScores: VendorWithScores[] = vendors?.map(vendor => {
    const vendorScores = scores?.filter(s => s.vendorId === vendor.id) || [];
    
    const executionScore = vendorScores
      .filter(s => executionCriteria.some(c => c.id === s.criteriaId))
      .reduce((sum, s) => sum + Number(s.score), 0) / Math.max(executionCriteria.length, 1);
    
    const viabilityScore = vendorScores
      .filter(s => viabilityCriteria.some(c => c.id === s.criteriaId))
      .reduce((sum, s) => sum + Number(s.score), 0) / Math.max(viabilityCriteria.length, 1);

    return {
      ...vendor,
      executionScore,
      viabilityScore,
    };
  }).sort((a, b) => (b.executionScore + b.viabilityScore) - (a.executionScore + a.viabilityScore)) || [];

  const VendorEvaluationTab = () => (
    <>
      {market.description && (
        <MobileCard className="mb-4">
          <MobileCardContent>
            <p className="text-sm text-gray-700">{market.description}</p>
          </MobileCardContent>
        </MobileCard>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <p className="text-sm text-blue-900">
          <strong>{vendorsWithScores.length}</strong> vendors evaluated in this market
        </p>
      </div>

      {vendorsWithScores.length > 0 && (
        <MobileCard className="mb-4">
          <MobileCardHeader>
            <MobileCardTitle>Vendor Evaluation Chart</MobileCardTitle>
          </MobileCardHeader>
          <MobileCardContent>
            <MobileVendorQuadrant vendors={vendorsWithScores} />
          </MobileCardContent>
        </MobileCard>
      )}

      {vendorsWithScores.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 px-1">Vendor Rankings</h3>
          {vendorsWithScores.map((vendor, index) => (
            <Link key={vendor.id} href={`/mobile/vendors/${vendor.id}`}>
              <a data-testid={`link-vendor-${vendor.id}`}>
                <MobileCard className="hover:shadow-md transition-shadow">
                  <MobileCardContent className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900">{vendor.name}</h4>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <div className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                              <TrendingUp className="h-3 w-3" />
                              <span>Execution</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-600 rounded-full transition-all"
                                  style={{ width: `${vendor.executionScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-900 w-10 text-right">
                                {Math.round(vendor.executionScore)}%
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                              <TrendingDown className="h-3 w-3" />
                              <span>Viability</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-green-600 rounded-full transition-all"
                                  style={{ width: `${vendor.viabilityScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-900 w-10 text-right">
                                {Math.round(vendor.viabilityScore)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </MobileCardContent>
                </MobileCard>
              </a>
            </Link>
          ))}
        </div>
      ) : (
        <MobileCard>
          <MobileCardContent className="py-8 text-center">
            <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No vendors available for this market</p>
          </MobileCardContent>
        </MobileCard>
      )}
    </>
  );

  const MarketNewsTab = () => {
    const { data: news, isLoading } = useQuery<NewsArticle[]>({
      queryKey: ["/api/markets", marketId, "news"],
      enabled: !!marketId,
    });

    if (isLoading) {
      return <MobileLoadingScreen message="Loading news..." />;
    }

    if (!news || news.length === 0) {
      return (
        <MobileCard>
          <MobileCardContent className="py-8 text-center">
            <p className="text-gray-600">No news available for this market</p>
          </MobileCardContent>
        </MobileCard>
      );
    }

    return (
      <div className="space-y-3">
        {news.map((article) => (
          <MobileCard key={article.id}>
            <MobileCardContent className="py-4">
              <h4 className="font-semibold text-gray-900 mb-2">{article.title}</h4>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  article.impactLabel === 'HIGH' ? 'bg-red-100 text-red-700' :
                  article.impactLabel === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {article.impactLabel} IMPACT
                </span>
                {article.publishedAt && (
                  <span className="text-xs text-gray-500">
                    {new Date(article.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {article.url && (
                <a 
                  href={article.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  Read more →
                </a>
              )}
            </MobileCardContent>
          </MobileCard>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <Link href="/mobile/dashboard">
              <a>
                <Button variant="ghost" size="sm" className="p-2">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </a>
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{market.name}</h1>
              <p className="text-sm text-gray-600">Market Analysis</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <Tabs defaultValue="vendor-evaluation" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="vendor-evaluation" className="text-xs px-2" data-testid="tab-vendor-eval">
              Vendor Eval
            </TabsTrigger>
            <TabsTrigger value="product-evaluation" className="text-xs px-2" data-testid="tab-product-eval">
              Product Eval
            </TabsTrigger>
            <TabsTrigger value="ecosystem" className="text-xs px-2" data-testid="tab-ecosystem">
              Ecosystem
            </TabsTrigger>
            <TabsTrigger value="news" className="text-xs px-2" data-testid="tab-news">
              News
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vendor-evaluation">
            <VendorEvaluationTab />
          </TabsContent>

          <TabsContent value="product-evaluation">
            <SupportMatrix marketId={marketId!} />
          </TabsContent>

          <TabsContent value="ecosystem">
            <EcosystemSupport marketId={marketId!} />
          </TabsContent>

          <TabsContent value="news">
            <MarketNewsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
