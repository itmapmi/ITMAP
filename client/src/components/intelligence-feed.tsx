import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SignalCard, type SignalData } from "@/components/signal-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Vendor } from "@shared/schema";

interface VendorSignalsPage {
  data: SignalData[];
  total: number;
  limit: number;
  offset: number;
}

const SOURCE_FILTERS = [
  { value: "all", label: "All" },
  { value: "hackernews", label: "HN" },
  { value: "reddit", label: "Reddit" },
  { value: "github", label: "GitHub" },
  { value: "layoffs", label: "Layoffs" },
] as const;

interface IntelligenceFeedProps {
  marketId: string;
  vendors: Vendor[];
}

export function IntelligenceFeed({ marketId, vendors }: IntelligenceFeedProps) {
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const signalsUrl = (() => {
    const base = `/api/markets/${marketId}/vendor-signals?limit=20`;
    const vendor = selectedVendorId !== "all" ? `&vendorId=${selectedVendorId}` : "";
    const source = sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : "";
    return `${base}${vendor}${source}`;
  })();

  const { data: page, isLoading } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Intelligence Feed</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Real-time signals from Hacker News, Reddit, GitHub, and Layoffs.fyi that inform vendor scoring.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
          <SelectTrigger className="w-48 h-9 text-sm">
            <SelectValue placeholder="All vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map(v => (
              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Source filter pills */}
        <div className="flex gap-1">
          {SOURCE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setSourceFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                sourceFilter === f.value
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : !page || page.data.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {selectedVendorId === "all"
            ? "No signals collected yet for this market."
            : "No signals collected yet for this vendor."}
        </div>
      ) : (
        <div className="space-y-2">
          {page.data.map(signal => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
          {page.total > page.data.length && (
            <p className="text-xs text-gray-400 text-center pt-2">
              Showing {page.data.length} of {page.total} signals
            </p>
          )}
        </div>
      )}
    </div>
  );
}
