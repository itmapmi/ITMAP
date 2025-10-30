import { useQuery } from "@tanstack/react-query";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardDescription, MobileCardContent } from "@/mobile/components/MobileCard";
import { MobileLoadingSpinner } from "@/mobile/components/MobileLoadingSpinner";
import { MobileEmptyState } from "@/mobile/components/MobileEmptyState";
import { Link } from "wouter";
import { BarChart3, ChevronRight } from "lucide-react";
import type { Market } from "@shared/schema";

export default function MobileMarkets() {
  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title="Markets"
        subtitle="Explore Technology Markets"
      />

      <div className="p-4 space-y-3">
        {isLoading ? (
          <MobileLoadingSpinner />
        ) : !markets || markets.length === 0 ? (
          <MobileEmptyState
            icon={BarChart3}
            title="No Markets Available"
            description="There are no markets to display at this time."
          />
        ) : (
          markets.map((market) => (
            <Link key={market.id} href={`/mobile/markets/${market.id}`}>
              <a data-testid={`link-market-${market.id}`}>
                <MobileCard className="hover:shadow-md transition-shadow">
                  <MobileCardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <MobileCardTitle className="line-clamp-2">{market.name}</MobileCardTitle>
                        {market.description && (
                          <MobileCardDescription className="line-clamp-2 mt-1">
                            {market.description}
                          </MobileCardDescription>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-1" />
                    </div>
                  </MobileCardHeader>
                </MobileCard>
              </a>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
