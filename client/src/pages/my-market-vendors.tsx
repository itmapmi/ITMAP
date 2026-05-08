import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Lock, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { VendorNewsroomManager } from "@/components/vendor-newsroom-manager";
import type { Market } from "@shared/schema";

export default function MyMarketVendorsPage() {
  const [, params] = useRoute("/me/markets/:marketId/vendors");
  const marketId = params?.marketId;
  const { user } = useAuth();

  const { data: market, isLoading, error } = useQuery<Market>({
    queryKey: ["/api/markets", marketId],
    enabled: !!marketId,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading market…
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Market not found</h1>
        <Link href="/markets">
          <Button variant="outline" className="mt-2"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Markets</Button>
        </Link>
      </div>
    );
  }

  const isOwner = !!(market.ownerUserId && user?.id === market.ownerUserId);
  const isAdmin = (user as any)?.role === "admin";
  if (!isOwner && !isAdmin) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <Lock className="h-10 w-10 text-gray-400 mx-auto mb-3" />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-sm text-gray-500 mb-5">Only the market owner can manage newsroom URLs.</p>
        <Link href={`/markets/${marketId}`}>
          <Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Market</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href={`/markets/${marketId}`}>
          <button className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to {market.name.replace(/^ITMAP for /i, "")}
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Manage Newsroom URLs</h1>
        <p className="text-sm text-gray-600 mt-1">
          Add the official press / newsroom page for each vendor so the platform can pull their news daily.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <VendorNewsroomManager marketId={marketId!} variant="full" />
      </div>
    </div>
  );
}
