import { useQuery } from "@tanstack/react-query";
import MarketGrid from "@/components/market-grid";
import { Skeleton } from "@/components/ui/skeleton";
import type { Market } from "@shared/schema";

export default function Home() {
  const { data: markets, isLoading, error } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading Markets</h1>
          <p className="text-gray-600">Unable to fetch market data. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Technology Markets</h1>
        <p className="text-gray-600">Explore comprehensive analysis across technology sectors</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <Skeleton className="h-48 w-full" />
              <div className="p-6">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : markets && markets.length > 0 ? (
        <MarketGrid markets={markets} />
      ) : (
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Markets Available</h2>
          <p className="text-gray-600">Markets will appear here once they are added by administrators.</p>
        </div>
      )}
    </div>
  );
}
