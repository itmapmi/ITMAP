import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardDescription } from "@/mobile/components/MobileCard";
import { MobileLoadingSpinner } from "@/mobile/components/MobileLoadingSpinner";
import { MobileEmptyState } from "@/mobile/components/MobileEmptyState";
import { Link } from "wouter";
import { BarChart3, ChevronRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Market } from "@shared/schema";

export default function MobileDashboard() {
  const { user, logout } = useAuth();

  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const handleLogout = async () => {
    await logout();
    window.location.href = "/mobile/login";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Logout */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Welcome, {user?.firstName || 'User'}
            </h1>
            <p className="text-sm text-gray-600">Technology Intelligence Platform</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            data-testid="button-logout"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Platform Banner */}
      <div className="p-4">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg">
          <h2 className="text-xl font-bold mb-2">ITMAP Platform</h2>
          <p className="text-blue-100 text-sm">
            Unbiased. Comprehensive. Your trusted source for technology market intelligence.
          </p>
        </div>
      </div>

      {/* Explore Markets Section */}
      <div className="px-4 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Explore Markets</h2>
        
        {isLoading ? (
          <MobileLoadingSpinner />
        ) : !markets || markets.length === 0 ? (
          <MobileEmptyState
            icon={BarChart3}
            title="No Markets Available"
            description="There are no markets to display at this time."
          />
        ) : (
          <div className="space-y-3">
            {markets.map((market) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
