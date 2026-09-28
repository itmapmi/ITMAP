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
import { useIsMobile } from "@/hooks/use-mobile";
import { CompanyProfileLockedPanel, isCompanyEmailRequiredError } from "@/components/company-profile-lock";
import { useTranslation } from "react-i18next";

interface VendorSignalsPage {
  data: SignalData[];
  total: number;
  limit: number;
  offset: number;
}

const SOURCE_FILTERS = [
  { value: "all", key: "filters.sources.all" },
  { value: "hackernews", key: "filters.sources.hn" },
  { value: "reddit", key: "filters.sources.reddit" },
  { value: "github", key: "filters.sources.github" },
  { value: "layoffs", key: "filters.sources.layoffs" },
  { value: "cve", key: "filters.sources.cve" },
] as const;

interface IntelligenceFeedProps {
  marketId: string;
  vendors: Vendor[];
}

export function IntelligenceFeed({ marketId, vendors }: IntelligenceFeedProps) {
  const { t, i18n } = useTranslation("intelligenceFeed");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const isMobile = useIsMobile();

  const signalsUrl = (() => {
    const base = `/api/markets/${marketId}/vendor-signals?limit=20`;
    const vendor = selectedVendorId !== "all" ? `&vendorId=${selectedVendorId}` : "";
    const source = sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : "";
    // Server translates title/content on demand and caches the result; the
    // buyer's language is included so a language switch refetches translated
    // text instead of reusing a cached English response.
    const language = `&language=${encodeURIComponent(i18n.language)}`;
    return `${base}${vendor}${source}${language}`;
  })();

  const { data: page, isLoading, error } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
  });

  if (isCompanyEmailRequiredError(error)) {
    return <CompanyProfileLockedPanel feature={t("locked.feature")} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t("heading")}</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          {t("description")}
        </p>
      </div>

      {/* Controls */}
      <div className={isMobile ? "flex flex-col gap-2" : "flex flex-wrap gap-2 items-center"}>
        <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
          <SelectTrigger className={isMobile ? "w-full h-9 text-sm" : "w-48 h-9 text-sm"}>
            <SelectValue placeholder={t("filters.allVendors")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allVendors")}</SelectItem>
            {vendors.map(v => (
              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Source filter pills */}
        <div className="flex gap-1 flex-wrap">
          {SOURCE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setSourceFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                sourceFilter === f.value
                  ? f.value === "cve"
                    ? "bg-violet-700 text-white"
                    : "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t(f.key)}
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
            ? sourceFilter === "cve"
              ? t("empty.noCveSignals")
              : t("empty.noMarketSignals")
            : t("empty.noVendorSignals")}
        </div>
      ) : (
        <div className="space-y-2">
          {page.data.map(signal => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
          {page.total > page.data.length && (
            <p className="text-xs text-gray-400 text-center pt-2">
              {t("pagination.showing", { shown: page.data.length, total: page.total })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
