import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { QuickActionCard } from "@/mobile/components/QuickActionCard";
import { MobileLoadingSpinner } from "@/mobile/components/MobileLoadingSpinner";
import { FileText, Building2, Layers, Newspaper, TrendingUp, BarChart3 } from "lucide-react";
import type { Market } from "@shared/schema";

export default function MobileDashboard() {
  const { user } = useAuth();

  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const featuredMarket = markets?.[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title={`Welcome, ${user?.firstName || 'User'}`}
        subtitle="Your Technology Intelligence Platform"
      />

      <div className="p-4 space-y-6">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg">
          <h2 className="text-xl font-bold mb-2">ITMAP Platform</h2>
          <p className="text-blue-100 text-sm">
            Unbiased. Comprehensive. Your trusted source for technology market intelligence.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 px-1">Quick Actions</h3>
          <div className="space-y-3">
            <QuickActionCard
              title="Browse Markets"
              description="Explore technology markets and vendor landscapes"
              icon={BarChart3}
              href="/mobile/markets"
              color="blue"
              testId="card-markets"
            />
            
            {featuredMarket && (
              <QuickActionCard
                title="Vendor Evaluation"
                description={`View ${featuredMarket.name} market analysis`}
                icon={TrendingUp}
                href={`/mobile/markets/${featuredMarket.id}`}
                color="purple"
                testId="card-vendor-evaluation"
              />
            )}
            
            <QuickActionCard
              title="All Vendors"
              description="Browse all technology vendors and solutions"
              icon={Building2}
              href="/mobile/vendors"
              color="green"
              testId="card-vendors"
            />
            
            <QuickActionCard
              title="Latest News"
              description="Stay updated with vendor news and announcements"
              icon={Newspaper}
              href="/mobile/news"
              color="orange"
              testId="card-news"
            />
          </div>
        </div>

        {isLoading ? (
          <MobileLoadingSpinner />
        ) : markets && markets.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 px-1">Recent Markets</h3>
            <div className="space-y-3">
              {markets.slice(0, 3).map((market) => (
                <QuickActionCard
                  key={market.id}
                  title={market.name}
                  description={market.description || "View market analysis and vendor evaluation"}
                  icon={FileText}
                  href={`/mobile/markets/${market.id}`}
                  color="blue"
                  testId={`card-market-${market.id}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
