import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, BarChart3, ChevronDown } from "lucide-react";
import MarketSectionHeader from "@/components/market-section-header";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport } from "@shared/schema";
import { getFeaturesForDerivedScore } from "@shared/derived-feature-scores";
import { categoryTranslationUnavailable, featureCategoryName } from "@/lib/feature-category-localization";
import { maximumFeatureCategoryScore, rankFeatureCategory } from "@/lib/feature-category-scoring";

type Category = FeatureWithCategory["category"];

export default function FeatureRankings({
  marketId,
  onOpenCompare,
  mobileMode = false,
}: {
  marketId: string;
  onOpenCompare: () => void;
  mobileMode?: boolean;
}) {
  const { t, i18n } = useTranslation("featureRankings");
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const { data: vendors, isLoading: vendorsLoading, isError: vendorsError } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });
  const { data: features, isLoading: featuresLoading, isError: featuresError } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", marketId, "features", i18n.language],
    queryFn: async () => {
      const response = await fetch(`/api/markets/${marketId}/features?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return response.json();
    },
  });
  const { data: supportMatrix, isLoading: supportLoading, isError: supportError } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", marketId, "feature-support", i18n.language],
    queryFn: async () => {
      const response = await fetch(`/api/markets/${marketId}/feature-support?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return response.json();
    },
  });

  const productFeatures = features
    ? getFeaturesForDerivedScore(features, "productCapabilities") as FeatureWithCategory[]
    : [];
  const byCategory = new Map<string, { category: Category; features: FeatureWithCategory[] }>();
  for (const feature of productFeatures) {
    let group = byCategory.get(feature.category.id);
    if (!group) {
      group = { category: feature.category, features: [] };
      byCategory.set(feature.category.id, group);
    }
    group.features.push(feature);
  }
  const categories = Array.from(byCategory.values()).sort((a, b) =>
    a.category.displayOrder - b.category.displayOrder || featureCategoryName(a.category).localeCompare(featureCategoryName(b.category))
  );
  const support = new Map<string, number>();
  for (const record of supportMatrix ?? []) {
    support.set(`${record.vendorId}-${record.featureId}`, record.supportLevel);
  }
  const loading = vendorsLoading || featuresLoading || supportLoading;
  const error = vendorsError || featuresError || supportError;

  return (
    <section className={`overflow-hidden ${mobileMode ? "rounded-none" : "rounded-xl"} border border-[#dfe8ed] bg-white shadow-[0_5px_16px_rgba(15,20,24,0.06)]`} aria-labelledby="feature-rankings-heading">
      {mobileMode ? <header className="border-b border-[#dfe8ed] bg-white px-4 py-5 sm:px-7">
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#13a8f0]">{t("eyebrow")}</p>
        <h2 id="feature-rankings-heading" className="mt-1 text-xl font-semibold tracking-tight text-[#0f1418]">{t("title")}</h2>
        <p className="mt-2 max-w-xl text-xs leading-5 text-[#66737b]">{t("description")}</p>
      </header> : (
        <MarketSectionHeader
          title={t("title")}
          description={t("description")}
          icon={BarChart3}
          tone="violet"
          headingId="feature-rankings-heading"
        />
      )}

      <div className="px-4 py-5 sm:px-7 sm:py-7">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe8ed] pb-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-[#516473]">{t("categories")}</h3>
          {!loading && !error && <span className="font-mono text-xs text-[#70808b]">{t("categoryCount", { count: categories.length })}</span>}
        </div>
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-[#66737b]">{t("loading")}</p>
        ) : error ? (
          <p role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("loadError")}</p>
        ) : !vendors?.length ? (
          <p className="border border-dashed border-[#c9d9e2] p-5 text-sm text-[#66737b]">{t("noVendors")}</p>
        ) : !categories.length ? (
          <p className="border border-dashed border-[#c9d9e2] p-5 text-sm text-[#66737b]">{t("noCategories")}</p>
        ) : (
          <div className="space-y-2.5">
            {categoryTranslationUnavailable(productFeatures) && (
              <p role="alert" className="text-sm text-amber-700">{t("translationUnavailable")}</p>
            )}
            {categories.map(({ category, features: categoryFeatures }, index) => {
              const isOpen = openCategoryId === category.id;
              const panelId = `ranking-category-${category.id}`;
              const maximum = maximumFeatureCategoryScore(categoryFeatures);
              const ranked = isOpen ? rankFeatureCategory(
                categoryFeatures,
                vendors,
                (vendorId, featureId) => support.get(`${vendorId}-${featureId}`),
              ) : [];
              return (
                <div key={category.id} className={`border transition-colors ${mobileMode ? "" : "overflow-hidden rounded-lg"} ${isOpen ? "border-[#8bc8e9] shadow-[0_8px_28px_rgba(8,127,202,0.09)]" : "border-[#dfe8ed] hover:border-[#a5c7d9]"}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className={`flex min-h-16 w-full scroll-mt-44 items-center gap-3 px-3 py-3 text-left sm:gap-5 sm:px-5 ${isOpen ? "bg-[#eaf5fa]" : "bg-white hover:bg-[#f7fafb]"}`}
                    onClick={(event) => {
                      if (openCategoryId && openCategoryId !== category.id) {
                        const button = event.currentTarget;
                        requestAnimationFrame(() => button.scrollIntoView({ block: "start", inline: "nearest" }));
                      }
                      setOpenCategoryId(current => current === category.id ? null : category.id);
                    }}
                  >
                    <span className="font-mono text-xs font-bold text-[#087fca]">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-[#172a37] sm:text-base">{featureCategoryName(category)}</span>
                    <span className="shrink-0 border border-[#dfe8ed] bg-white px-2 py-1 font-mono text-[10px] text-[#66737b]">{t("featureCount", { count: maximum })}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-[#087fca] transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div id={panelId} className="border-t border-[#dfe8ed] bg-white px-3 pb-5 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
                      <div className="mb-5 flex items-end justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#087fca]">{t("rankedHeading")}</p>
                          <p className="mt-1 text-xs text-[#66737b]">{t("rankedDescription")}</p>
                        </div>
                        <span className="hidden shrink-0 font-mono text-[10px] uppercase text-[#84949e] sm:inline">{t("scoreLabel")}</span>
                      </div>
                      <div className="space-y-5">
                        {ranked.map(({ vendor, score, recorded }, rank) => (
                          <div key={vendor.id} className="grid gap-2 sm:grid-cols-[minmax(170px,32%)_minmax(0,1fr)] sm:items-center sm:gap-6">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center font-mono text-[10px] font-bold ${rank === 0 && score !== null ? "bg-[#087fca] text-white" : "bg-[#edf2f5] text-[#61727e]"}`}>
                                {String(rank + 1).padStart(2, "0")}
                              </span>
                              <div className="min-w-0">
                                <strong className="block truncate text-xs text-[#172a37] sm:text-sm" title={vendor.name}>{vendor.name}</strong>
                                {vendor.product && <span className="block truncate text-[11px] text-[#66737b]" title={vendor.product}>{vendor.product}</span>}
                              </div>
                            </div>
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="relative h-3 min-w-0 flex-1 overflow-hidden bg-[#e8eef2]" role="img" aria-label={score === null
                                ? t("unscoredAccessible", { vendor: vendor.name })
                                : t("scoreAccessible", { vendor: vendor.name, score, maximum })}>
                                {score !== null && <div className={`h-full ${rank === 0 ? "bg-[#087fca]" : "bg-[#68b9dc]"}`} style={{ width: `${Math.max(0, Math.min(100, score / maximum * 100))}%` }} />}
                              </div>
                              <span className="w-[72px] shrink-0 text-right font-mono text-xs font-bold tabular-nums text-[#172a37] sm:w-[82px] sm:text-sm">
                                {score === null ? t("unscored") : <>{score}<span className="font-normal text-[#8999a2]"> / {maximum}</span></>}
                              </span>
                            </div>
                            {recorded > 0 && recorded < maximum && (
                              <p className="text-[11px] text-[#866213] sm:col-start-2">{t("partialRecords", { recorded, maximum })}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-7 border-t border-[#dfe8ed] pt-4">
                        <p className="text-xs font-semibold text-[#172a37]">{t("maximum", { maximum })}</p>
                        <p className="mt-2 text-xs leading-5 text-[#66737b]">
                          {t("rationale")}{" "}
                          <button type="button" onClick={onOpenCompare} className="inline-flex items-center gap-1 font-semibold text-[#087fca] underline decoration-[#87c5e6] underline-offset-2 hover:text-[#065f99]">
                            {t("compareProducts")} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}