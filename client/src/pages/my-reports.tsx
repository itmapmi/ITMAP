import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FileText, Lock, Sparkles } from "lucide-react";
import type { Market } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

export default function MyReportsPage() {
  const { user } = useAuth();
  // /api/markets returns markets the user can see — we filter to markets the
  // user owns (private markets they built via Market Builder).
  const { data: markets = [], isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });
  const myMarkets = markets.filter((m: any) => m.ownerUserId === user?.id);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/me/market-builder">
          <a className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ChevronLeft className="h-4 w-4" />Back to Market Builder
          </a>
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <FileText className="h-6 w-6 text-blue-600" /> My Reports
      </h1>
      <p className="text-sm text-gray-500 mb-6 flex items-center gap-1.5">
        <Lock className="h-3.5 w-3.5" />
        Private markets you've built. Only you can see these.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : myMarkets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <Sparkles className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-700 font-medium">No private markets yet</p>
          <p className="text-xs text-gray-500 mt-1">Use the Market Builder to create your first one.</p>
          <Link href="/me/market-builder">
            <a className="inline-block mt-4 text-sm text-blue-600 hover:underline">Open Market Builder →</a>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {myMarkets.map(m => (
            <Link key={m.id} href={`/market/${m.id}`}>
              <a className="block rounded-lg border bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{m.name}</p>
                    {m.description && (
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{m.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 shrink-0">
                    Private
                  </span>
                </div>
              </a>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
