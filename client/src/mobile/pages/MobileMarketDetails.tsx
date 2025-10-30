import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardContent } from "@/mobile/components/MobileCard";
import { MobileLoadingScreen } from "@/mobile/components/MobileLoadingSpinner";
import { CollapsibleSection } from "@/mobile/components/CollapsibleSection";
import { MobileVendorQuadrant } from "@/mobile/components/MobileVendorQuadrant";
import { Link } from "wouter";
import { Building2, TrendingUp, TrendingDown } from "lucide-react";
import type { Market, Vendor, VendorScore, Criteria } from "@shared/schema";

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
      .reduce((sum, s) => sum + s.score, 0) / Math.max(executionCriteria.length, 1);
    
    const viabilityScore = vendorScores
      .filter(s => viabilityCriteria.some(c => c.id === s.criteriaId))
      .reduce((sum, s) => sum + s.score, 0) / Math.max(viabilityCriteria.length, 1);

    return {
      ...vendor,
      executionScore,
      viabilityScore,
    };
  }).sort((a, b) => (b.executionScore + b.viabilityScore) - (a.executionScore + a.viabilityScore)) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title={market.name}
        subtitle="Vendor Evaluation"
        showBack
      />

      <div className="p-4 space-y-4">
        {market.description && (
          <MobileCard>
            <MobileCardContent>
              <p className="text-sm text-gray-700">{market.description}</p>
            </MobileCardContent>
          </MobileCard>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            <strong>{vendorsWithScores.length}</strong> vendors evaluated in this market
          </p>
        </div>

        {vendorsWithScores.length > 0 && (
          <MobileCard>
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
      </div>
    </div>
  );
}
