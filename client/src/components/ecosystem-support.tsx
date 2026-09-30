import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Eye, ChevronDown, ChevronRight, FileText, Filter, Network, Globe, TrendingUp, Info, FileDown, Lock, Check } from "lucide-react";
import { VendorSelectionModal } from "./vendor-selection-modal";
import { track } from "@/lib/track";
import { recordHighIntentAction } from "@/lib/high-intent";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import type { FeatureWithCategory, Feature, Vendor, VendorFeatureSupport } from "@shared/schema";
import { featureCategoryName, categoryTranslationUnavailable } from "@/lib/feature-category-localization";
import { formatCoveragePercent, getFeaturesForDerivedScore, supportLevelContribution } from "@shared/derived-feature-scores";
import { useDerivedCriterionScores } from "@/hooks/use-derived-criterion-scores";

interface EcosystemSupportProps {
  marketId: string;
  /** When true, anonymous visitors must register before generating a PDF report. */
  pdfLocked?: boolean;
  /** Called instead of opening the vendor-selection modal when pdfLocked is true. */
  onPdfLockedClick?: () => void;
  /** True only on the /mobile/* route — uses the approved two-product
   * comparison and its accessible stored-commentary dialog. */
  mobileMode?: boolean;
}

const MOBILE_VENDOR_CAP = 2;

// Harvey Ball icons representing different support levels
const HarveyBall = ({ 
  level, 
  notes, 
  vendorName, 
  featureName, 
  onClick,
  isMobile = false
}: { 
  level: number; 
  notes?: string; 
  vendorName: string; 
  featureName: string; 
  onClick: () => void; 
  isMobile?: boolean;
}) => {
  const { t } = useTranslation("ecosystemSupport");

  const getHarveyBallIcon = (level: number) => {
    switch (level) {
      case 0: return "○"; // Empty circle - No support
      case 1: return "◔"; // Quarter filled - Limited support
      case 2: return "◑"; // Half filled - Partial support
      case 3: return "◕"; // Three quarters filled - Good support
      case 4: return "●"; // Full circle - Full support
      default: return "○";
    }
  };

  const getHarveyBallColor = (level: number) => {
    switch (level) {
      case 0: return "text-gray-300";
      case 1: return "text-orange-500";
      case 2: return "text-yellow-500";
      case 3: return "text-blue-500";
      case 4: return "text-green-500";
      default: return "text-gray-300";
    }
  };

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return t("support.level.noSupport");
      case 1: return t("support.level.limited");
      case 2: return t("support.level.partial");
      case 3: return t("support.level.good");
      case 4: return t("support.level.fullSupport");
      default: return t("support.level.unknown");
    }
  };

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={onClick}
        className={`${isMobile ? 'text-3xl p-2' : 'text-2xl p-1'} ${getHarveyBallColor(level)} hover:scale-125 transition-all duration-200 cursor-pointer relative group shadow-sm hover:shadow-md rounded-full ${isMobile ? 'min-w-[44px] min-h-[44px]' : ''}`}
        title={notes
          ? t("support.tooltipWithNotes", { level: getSupportText(level) })
          : t("support.tooltip", { level: getSupportText(level) })}
      >
        {getHarveyBallIcon(level)}
        {notes && (
          <FileText className="absolute -top-1 -right-1 h-3 w-3 text-blue-600 opacity-75" />
        )}
      </button>
    </div>
  );
};

export default function EcosystemSupport({ marketId, pdfLocked, onPdfLockedClick, mobileMode = false }: EcosystemSupportProps) {
  const { t, i18n } = useTranslation("ecosystemSupport");
  // Refs for scroll synchronization
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const supportSectionRef = useRef<HTMLElement>(null);
  const previousSelectionCount = useRef(0);
  const pendingScrollAfterLoad = useRef(false);

  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [categoriesInitialized, setCategoriesInitialized] = useState(false);
  const [showVendorSelection, setShowVendorSelection] = useState(true); // Show selection by default
  const [selectedNotes, setSelectedNotes] = useState<{
    vendorName: string;
    productName?: string | null;
    featureName: string;
    notes: string;
    supportLevel: number;
    unavailable?: boolean;
  } | null>(null);
  const [expandedNoteKey] = useState<string | null>(null);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const { data: features, isLoading: featuresLoading } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", marketId, "features", i18n.language],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/features?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const { data: allVendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<
    (VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]
  >({
    queryKey: ["/api/markets", marketId, "feature-support", i18n.language],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/feature-support?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  // Persisted ISV Ecosystem scores (derived server-side from this matrix);
  // the final score row reads these rather than recomputing.
  const isvEcosystemScores = useDerivedCriterionScores(marketId, "isvEcosystem");

  const evaluationLoading = featuresLoading || supportLoading;
  const isLoading = vendorsLoading || (!mobileMode && evaluationLoading);

  useEffect(() => {
    const count = selectedVendors.size;
    if (mobileMode && previousSelectionCount.current < MOBILE_VENDOR_CAP && count === MOBILE_VENDOR_CAP) {
      pendingScrollAfterLoad.current = evaluationLoading;
      recordHighIntentAction("ecosystem_comparison_opened", {
        marketId,
        metadata: { vendorCount: count },
      });
      supportSectionRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    } else if (mobileMode && count === MOBILE_VENDOR_CAP && pendingScrollAfterLoad.current && !evaluationLoading) {
      pendingScrollAfterLoad.current = false;
      supportSectionRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }
    if (count < MOBILE_VENDOR_CAP) pendingScrollAfterLoad.current = false;
    previousSelectionCount.current = count;
  }, [evaluationLoading, marketId, mobileMode, selectedVendors]);

  // Handler for generating ecosystem report
  const handleGenerateReport = async (selectedVendorIds: string[]) => {
    setIsGenerating(true);
    try {
      const response = await apiRequest(
        `/api/markets/${marketId}/generate-ecosystem-pdf`,
        "POST",
        { vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined }
      );

      if (!response.ok) {
        throw new Error(t("messages.generateFailed"));
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : 'Spectio ISV Ecosystem Report.pdf';
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t("messages.success"),
        description: t("messages.reportGenerated"),
      });

      setShowVendorModal(false);
    } catch (error) {
      console.error("Error generating report:", error);
      toast({
        title: t("messages.error"),
        description: t("messages.generateFailed"),
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Same partition the persisted ISV Ecosystem score is derived from
  // (shared/derived-feature-scores.ts), so this tab always matches the chart.
  const ecosystemFeatures = features
    ? (getFeaturesForDerivedScore(features, "isvEcosystem") as FeatureWithCategory[])
    : [];

  // Do not auto-select vendors - require user selection

  // Scroll synchronization effect
  useEffect(() => {
    const container = containerRef.current;
    const stickyHeader = stickyHeaderRef.current;

    if (!container || !stickyHeader) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      stickyHeader.style.transform = `translateX(-${scrollLeft}px)`;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [allVendors, selectedVendors]); // Re-run when vendor data changes to ensure DOM is ready

  // Initialize with all categories collapsed when features load (only once)
  useEffect(() => {
    if (features && !categoriesInitialized) {
      const uniqueCategoryIds = new Set(features.map(f => f.category.id));
      setCollapsedCategories(uniqueCategoryIds);
      setCategoriesInitialized(true);
    }
  }, [features, categoriesInitialized]);

  // Filter vendors based on selection
  const vendors = allVendors?.filter(vendor => selectedVendors.has(vendor.id)) || [];

  const handleProceedWithSelection = () => {
    if (selectedVendors.size > 0 && (!mobileMode || selectedVendors.size === MOBILE_VENDOR_CAP)) {
      (allVendors ?? [])
        .filter((v) => selectedVendors.has(v.id))
        .forEach((v) =>
          track("vendor_selected", {
            marketId,
            vendorId: v.id,
            metadata: { context: "ecosystem_evaluation", vendorName: v.name },
          }),
        );
      if (selectedVendors.size >= 2) {
        recordHighIntentAction("ecosystem_comparison_opened", {
          marketId,
          metadata: { vendorCount: selectedVendors.size },
        });
      }
      setShowVendorSelection(false);
    }
  };

  const toggleVendor = (vendorId: string) => {
    setSelectedVendors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(vendorId)) {
        newSet.delete(vendorId);
      } else {
        if (mobileMode && newSet.size >= MOBILE_VENDOR_CAP) {
          toast({
            title: t("selection.twoProductsSelectedTitle"),
            description: t("selection.deselectOneDescription"),
          });
          return prev;
        }
        newSet.add(vendorId);
      }
      return newSet;
    });
  };

  const selectAllVendors = () => {
    if (allVendors) {
      const ids = mobileMode ? allVendors.slice(0, MOBILE_VENDOR_CAP).map(v => v.id) : allVendors.map(v => v.id);
      setSelectedVendors(new Set(ids));
    }
  };

  const clearAllVendors = () => {
    setSelectedVendors(new Set());
  };

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const expandAllCategories = () => {
    setCollapsedCategories(new Set());
  };

  const collapseAllCategories = () => {
    if (ecosystemFeatures) {
      const uniqueCategoryIds = new Set(ecosystemFeatures.map(f => f.category.id));
      setCollapsedCategories(uniqueCategoryIds);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-white to-green-50/30 border-green-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-green-500" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex space-x-4">
                <Skeleton className="h-8 w-48" />
                <div className="flex space-x-2">
                  {[...Array(3)].map((_, j) => (
                    <Skeleton key={j} className="h-8 w-8 rounded-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show vendor selection interface first
  if (!mobileMode && (showVendorSelection || selectedVendors.size === 0)) {
    return (
      <Card className="bg-gradient-to-br from-white to-green-50/30 border-green-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-green-500" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("selection.chooseVendorsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="text-center text-gray-500">{t("selection.loadingVendors")}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="p-4 border rounded-lg">
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : allVendors && allVendors.length > 0 ? (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("selection.chooseVendorsHeading")}</h3>
                <p className="text-gray-600 mb-4">{t("selection.chooseVendorsPrompt")}</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allVendors.map(vendor => (
                  <div 
                    key={vendor.id} 
                    className={`border rounded-lg p-4 cursor-pointer transition-all duration-200 ${
                      selectedVendors.has(vendor.id) 
                        ? 'border-green-500 bg-green-50 shadow-md' 
                        : 'border-gray-200 hover:border-green-300 hover:shadow-sm'
                    }`}
                    onClick={() => toggleVendor(vendor.id)}
                    data-testid={`vendor-card-${vendor.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900">{vendor.name}</h4>
                        {vendor.product && (
                          <p className="text-sm text-gray-600 mt-1">{vendor.product}</p>
                        )}
                      </div>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedVendors.has(vendor.id)
                          ? 'border-green-500 bg-green-500'
                          : 'border-gray-300'
                      }`}>
                        {selectedVendors.has(vendor.id) && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm text-gray-600">
                  {selectedVendors.size === 0
                    ? t("selection.noVendorsSelected")
                    : t("selection.vendorsSelected", { count: selectedVendors.size })}
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedVendors(new Set())}
                    disabled={selectedVendors.size === 0}
                    data-testid="clear-vendors-button"
                  >
                    {t("selection.clearAll")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={selectAllVendors}
                    data-testid="select-all-vendors-button"
                  >
                    {t("selection.selectAll")}
                  </Button>
                  <Button
                    onClick={handleProceedWithSelection}
                    disabled={selectedVendors.size === 0 || (mobileMode && selectedVendors.size !== MOBILE_VENDOR_CAP)}
                    className="bg-green-600 hover:bg-green-700"
                    data-testid="proceed-with-selection-button"
                  >
                    {mobileMode
                      ? t("selection.compareCount", { count: selectedVendors.size })
                      : t("selection.viewEcosystemSupport", { count: selectedVendors.size })}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500">
              <p>{t("selection.noVendorsAvailable")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!mobileMode && (!ecosystemFeatures || !vendors || !supportMatrix)) {
    return (
      <Card className="bg-gradient-to-br from-white to-green-50/30 border-green-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-green-500" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-gray-500">{t("empty.noSupportData")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!mobileMode && ecosystemFeatures.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-white to-green-50/30 border-green-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-green-500" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="text-center py-12">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4">
              <Network className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">{t("empty.noFeaturesHeading")}</p>
            <p className="text-gray-500">{t("empty.noFeaturesDescription")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Create support lookup map with notes
  const supportLookup = new Map<string, { level: number; notes?: string }>();
  supportMatrix?.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, { 
      level: support.supportLevel, 
      notes: support.comments || undefined 
    });
  });

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return t("support.level.noSupport");
      case 1: return t("support.level.limited");
      case 2: return t("support.level.partial");
      case 3: return t("support.level.good");
      case 4: return t("support.level.fullSupport");
      default: return t("support.level.unknown");
    }
  };

  if (mobileMode) {
    const featuresByCategory = ecosystemFeatures.reduce((acc, feature) => {
      const id = feature.category.id;
      if (!acc[id]) acc[id] = { category: feature.category, features: [] };
      acc[id].features.push(feature);
      return acc;
    }, {} as Record<string, { category: FeatureWithCategory["category"]; features: FeatureWithCategory[] }>);
    const categories = Object.values(featuresByCategory).sort(
      (a, b) => a.category.displayOrder - b.category.displayOrder,
    );

    const openNotes = (vendor: Vendor, feature: FeatureWithCategory) => {
      const record = supportLookup.get(`${vendor.id}-${feature.id}`);
      setSelectedNotes({
        vendorName: vendor.name,
        productName: vendor.product,
        featureName: feature.name,
        supportLevel: record?.level ?? 0,
        unavailable: !record,
        notes: !record ? t("notes.supportRecordUnavailable") : record.notes?.trim() || t("notes.noStoredCommentary"),
      });
    };

    return (
      <Card className="overflow-hidden rounded-none border-[#dfe8ed] bg-white shadow-[0_5px_16px_rgba(15,20,24,0.06)]">
        <CardHeader className="border-b border-[#dfe8ed] bg-white px-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#13a8f0]">{t("headingEvaluation")}</p>
              <CardTitle className="mt-1 text-xl text-[#0f1418]">{t("heading")}</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (pdfLocked ? onPdfLockedClick?.() : setShowVendorModal(true))}
              className="hidden shrink-0 rounded-none border-[#dfe8ed] px-2 text-[11px]"
              data-testid="button-generate-ecosystem-report"
            >
              {pdfLocked ? <Lock className="mr-1 h-3.5 w-3.5" /> : <FileDown className="mr-1 h-3.5 w-3.5" />}
              {t("reports.pdf")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-7 p-4">
          {features && categoryTranslationUnavailable(ecosystemFeatures) && (
            <p role="alert" className="text-sm text-amber-700">{t("categoryTranslationUnavailable")}</p>
          )}
          <section aria-labelledby="mobile-ecosystem-picker-title">
            <div className="flex items-end border-b border-[#dfe8ed] pb-2">
              <span className="mr-3 font-mono text-[10px] font-bold text-[#13a8f0]">01</span>
              <h2 id="mobile-ecosystem-picker-title" className="text-sm font-bold text-[#0f1418]">{t("selection.productsToCompare")}</h2>
            </div>
            {allVendors && allVendors.length > 0 ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t("selection.productsToCompare")}>
                  {allVendors.map((vendor) => {
                    const active = selectedVendors.has(vendor.id);
                    return (
                      <button
                        type="button"
                        key={vendor.id}
                        onClick={() => {
                          if (!active) {
                            track("vendor_selected", {
                              marketId,
                              vendorId: vendor.id,
                              metadata: { context: "ecosystem_evaluation", vendorName: vendor.name },
                            });
                          }
                          toggleVendor(vendor.id);
                        }}
                        aria-pressed={active}
                        className={`min-h-20 border p-2 text-left transition-colors ${
                          active
                            ? "border-[#13a8f0] bg-[#dcebf6] text-[#0f1418] shadow-[inset_3px_0_#13a8f0]"
                            : "border-[#dfe8ed] bg-white text-[#66737b]"
                        }`}
                        data-testid={`vendor-card-${vendor.id}`}
                      >
                        <span className="flex items-start gap-2">
                          <span className={`grid h-[21px] w-[21px] shrink-0 place-items-center border ${
                            active ? "border-[#13a8f0] bg-[#13a8f0] text-white" : "border-[#b9cbd5]"
                          }`}>
                            {active && <Check className="h-3 w-3" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0">
                            <strong className="block break-words text-xs leading-4">{vendor.name}</strong>
                            <small className="mt-1 block break-words text-[10px] leading-[1.3] text-[#66737b]">
                              {vendor.product || t("selection.productNameUnavailable")}
                            </small>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[#66737b]">
                  {t("selection.compareCount", { count: selectedVendors.size })}
                </p>
              </>
            ) : (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-4 text-center text-xs text-[#66737b]">
                {t("selection.noProducts")}
              </div>
            )}
            <div className="mt-3 grid grid-cols-5 gap-1 border border-[#dfe8ed] bg-[#f7f9f9] p-2">
              {(["none", "limited", "partial", "good", "full"] as const).map((level, index) => (
                <span key={level} className="text-center font-mono text-[8px] uppercase text-[#66737b]">
                  <i className="mx-auto mb-1 block h-2 w-2 rounded-full" style={{ background: ["#e6e6e6", "#f7b51e", "#00b890", "#18bf72", "#13a8f0"][index] }} />
                  {index} {t(`support.legend.${level}`)}
                </span>
              ))}
            </div>
          </section>

          <section ref={supportSectionRef} aria-labelledby="mobile-ecosystem-support-title" className="scroll-mt-32">
            <div className="flex items-end border-b border-[#dfe8ed] pb-2">
              <span className="mr-3 font-mono text-[10px] font-bold text-[#13a8f0]">02</span>
              <h2 id="mobile-ecosystem-support-title" className="text-sm font-bold text-[#0f1418]">{t("heading")} &amp; {t("notes.storedCommentary")}</h2>
            </div>
            {selectedVendors.size !== MOBILE_VENDOR_CAP ? (
              null
            ) : evaluationLoading ? (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-5 text-center text-xs text-[#66737b]" role="status">
                {t("headingEvaluation")}…
              </div>
            ) : !supportMatrix ? (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-5 text-center text-xs text-[#66737b]">
                {t("empty.noStoredSupportRecords")}
              </div>
            ) : categories.length === 0 ? (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-5 text-center text-xs text-[#66737b]">
                {t("empty.noStoredFeatureEvaluations")}
              </div>
            ) : (
              <div className="mt-3 border border-[#dfe8ed] bg-white">
            <div className="grid grid-cols-3 bg-[#0f1418] text-white">
              <span className="border-r border-white/15 p-2 font-mono text-[9px] font-bold uppercase text-[#9bbbd0]">{t("table.feature")}</span>
              {vendors.map((vendor) => (
                <span key={vendor.id} className="border-r border-white/15 p-2">
                  <strong className="block break-words text-[11px] leading-tight text-white">{vendor.name}</strong>
                  <small className="mt-1 block break-words text-[9px] leading-tight text-[#bdd3d1]">
                    {vendor.product || t("selection.productUnavailable")}
                  </small>
                </span>
              ))}
            </div>
            {categories.map(({ category, features: categoryFeatures }) => {
               const isOpen = !collapsedCategories.has(category.id);
              const panelId = `ecosystem-category-${category.id}`;
              return (
                <section key={category.id} className="border-t border-[#dfe8ed]">
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex min-h-[54px] w-full items-center justify-between bg-[#e6f0f5] px-3 py-2 text-left"
                  >
                    <span>
                      <strong className="block text-xs text-[#0f1418]">{featureCategoryName(category)}</strong>
                      <small className="mt-1 block text-[10px] text-[#66737b]">{t("evaluation.storedRows", { count: categoryFeatures.length })}</small>
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <div id={panelId}>
                      {categoryFeatures.map((feature) => (
                        <article key={feature.id} className="border-t border-[#dfe8ed] p-3">
                          <h3 className="m-0 text-xs font-semibold text-[#0f1418]">{feature.name}</h3>
                          <p className="mb-2.5 mt-1 text-[11px] leading-[1.4] text-[#66737b]">
                            {feature.description || t("evaluation.noCriteriaForFeature")}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {vendors.map((vendor) => {
                              const record = supportLookup.get(`${vendor.id}-${feature.id}`);
                              return (
                                <div key={vendor.id} className="min-w-0 border border-[#dfe8ed] bg-white p-2">
                                  <span className="mb-1.5 block break-words font-mono text-[10px] font-bold text-[#0f1418]">{vendor.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span
                                      role="img"
                                      aria-label={record ? t("support.accessibleLevel", { level: record.level }) : t("selection.unavailable")}
                                      className={`block h-7 w-7 shrink-0 rounded-full border-[2px] ${record ? "border-[#00b890]" : "border-dashed border-[#b9cbd5]"}`}
                                      style={record ? {
                                        background: `conic-gradient(#00b890 ${record.level * 25}%, #e6e6e6 0)`,
                                        boxShadow: "inset 0 0 0 3px #fff",
                                      } : undefined}
                                    />
                                    <b className="font-mono text-[10px] text-[#087fca]">
                                      {record ? `${record.level} / 4` : t("selection.unavailable")}
                                    </b>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openNotes(vendor, feature)}
                                    className="mt-2 min-h-9 w-full border border-[#b9d8ec] bg-[#dcebf6] px-1 text-[10px] font-bold text-[#087fca]"
                                    aria-label={t("notes.viewNotesFor", { vendor: vendor.name, feature: feature.name })}
                                  >
                                    {t("notes.viewNotes")}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
              </div>
            )}
          </section>
        </CardContent>

        <Dialog open={!!selectedNotes} onOpenChange={(open) => !open && setSelectedNotes(null)}>
          <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm flex-col gap-0 overflow-hidden rounded-none border-[#dfe8ed] p-0">
            <DialogHeader className="border-b border-[#dfe8ed] p-4 pr-10 text-left">
              <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#66737b]">{t("notes.evaluationNotes")}</p>
              <DialogTitle className="mt-1 text-base text-[#0f1418]">{selectedNotes?.featureName}</DialogTitle>
            </DialogHeader>
            {selectedNotes && (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="ecosystem-notes-body">
                <div className="grid grid-cols-2 border-b border-[#d6dcd6] px-4">
                  <div className="py-3 pr-2">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#7a8787]">{t("notes.vendor")}</span>
                    <strong className="mt-1 block break-words text-xs">{selectedNotes.vendorName}</strong>
                  </div>
                  <div className="py-3">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#7a8787]">{t("notes.product")}</span>
                    <strong className="mt-1 block break-words text-xs">{selectedNotes.productName || t("selection.unavailable")}</strong>
                  </div>
                  <div className="col-span-2 border-t border-[#e4e6e0] py-3">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#7a8787]">{t("notes.support")}</span>
                    <strong className="mt-1 block text-xs">
                      {selectedNotes.unavailable
                        ? t("notes.supportRecordUnavailable")
                        : t("notes.supportLevel", { level: selectedNotes.supportLevel, support: getSupportText(selectedNotes.supportLevel) })}
                    </strong>
                  </div>
                </div>
                <div className="p-4">
                  <span className="font-mono text-[9px] font-bold uppercase text-[#7a8787]">{t("notes.storedCommentary")}</span>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#42565d]">{selectedNotes.notes}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <VendorSelectionModal
          open={showVendorModal}
          onOpenChange={setShowVendorModal}
          vendors={allVendors || []}
          onGenerate={handleGenerateReport}
          title={t("reports.generateTitle")}
          description={t("reports.generateDescription")}
          isGenerating={isGenerating}
        />
      </Card>
    );
  }

  // Convert a Harvey ball support level to its score contribution, using the
  // shared roll-up so this matches the persisted derived criterion scores.
  const getEcosystemFeatureScore = (level: number) => supportLevelContribution(level);

  // Calculate ecosystem support totals for each vendor
  const getEcosystemTotals = () => {
    // Raw roll-up only ("Total Score" / "Maximum"). The 0–10 ISV Ecosystem
    // criterion is derived and persisted server-side; see useDerivedCriterionScores.
    const vendorTotals: Record<string, { totalScore: number; maxScore: number }> = {};
    
    vendors.forEach(vendor => {
      let totalScore = 0;
      let maxScore = 0;
      
      ecosystemFeatures.forEach(feature => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const support = supportLookup.get(supportKey);
        const level = support?.level || 0;
        
        totalScore += getEcosystemFeatureScore(level);
        maxScore += 1.0;
      });
      
      vendorTotals[vendor.id] = {
        totalScore: Number(totalScore.toFixed(2)),
        maxScore,
      };
    });
    
    return vendorTotals;
  };

  const ecosystemTotals = getEcosystemTotals();

  // Per-category totals shown in the collapsed category header row — mirrors
  // Compare Products' calculateCategoryTotals so both pages read the same way.
  const calculateCategoryTotals = (categoryFeatures: FeatureWithCategory[], vendors: Vendor[]) => {
    return vendors.map(vendor => {
      const total = categoryFeatures.reduce((sum, feature) => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const supportData = supportLookup.get(supportKey) || { level: 0 };
        return sum + getEcosystemFeatureScore(supportData.level);
      }, 0);
      return { vendorId: vendor.id, total: Number(total.toFixed(2)) };
    });
  };

  const handleHarveyBallClick = (vendorName: string, featureName: string, supportLevel: number, notes?: string, key?: string) => {
    if (mobileMode) {
      setSelectedNotes({ vendorName, featureName, supportLevel, notes: notes || t("notes.noStoredCommentary") });
      return;
    }
    if (notes) {
      setSelectedNotes({
        vendorName,
        featureName, 
        notes,
        supportLevel
      });
    }
  };

  return (
    <Card className="bg-gradient-to-br from-white to-green-50/30 border-green-100 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg shadow-md">
                <Network className="h-5 w-5 text-white" />
              </div>
              {t("heading")}
              <Badge variant="secondary" className="bg-green-100 text-green-700 shadow-sm">
                <Globe className="h-3 w-3 mr-1" />
                {t("selection.vendorCount", { selected: vendors.length, total: allVendors?.length || 0 })}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-4 flex-wrap mt-3">
              <span className="text-gray-600 flex items-center gap-2">
                <Info className="h-4 w-4" />
                {t("description")}
              </span>
              <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg border border-white/40 backdrop-blur-sm">
                <div className="flex items-center gap-1">
                  <span className="text-green-500 text-lg font-bold">●</span>
                  <span className="text-xs font-medium">{t("support.legend.full")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-blue-500 text-lg font-bold">◕</span>
                  <span className="text-xs font-medium">{t("support.legend.good")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-500 text-lg font-bold">◑</span>
                  <span className="text-xs font-medium">{t("support.legend.partial")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-orange-500 text-lg font-bold">◔</span>
                  <span className="text-xs font-medium">{t("support.legend.limited")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-lg font-bold">○</span>
                  <span className="text-xs font-medium">{t("support.legend.none")}</span>
                </div>
              </div>
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => (pdfLocked ? onPdfLockedClick?.() : setShowVendorModal(true))}
              variant="outline"
              size="sm"
              className={`hidden items-center gap-2 transition-all duration-200 ${pdfLocked ? 'text-muted-foreground' : 'hover:bg-green-50 hover:border-green-300'}`}
              data-testid="button-generate-ecosystem-report"
            >
              {pdfLocked ? <Lock className="h-4 w-4" /> : <FileDown className="h-4 w-4" />}
              {t("reports.pdfReport")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowVendorSelection(true)}
              className="flex items-center gap-2 hover:bg-green-50 hover:border-green-300 transition-all duration-200"
              data-testid="back-to-vendor-selection-button"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              {t("selection.changeSelection")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={expandAllCategories}
                className="flex items-center gap-2 hover:bg-green-50 hover:border-green-300 transition-all duration-200"
              >
                <ChevronDown className="h-4 w-4" />
                {t("categories.expandAll")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={collapseAllCategories}
                className="flex items-center gap-2 hover:bg-green-50 hover:border-green-300 transition-all duration-200"
              >
                <ChevronRight className="h-4 w-4" />
                {t("categories.collapseAll")}
              </Button>
            </div>
            <Button
              variant={showVendorSelection ? "default" : "outline"}
              size="sm"
              onClick={() => setShowVendorSelection(!showVendorSelection)}
              className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white border-0 shadow-md transition-all duration-200"
            >
              <Filter className="h-4 w-4" />
              {showVendorSelection ? t("selection.hideFilters") : t("selection.filterVendors")}
            </Button>
          </div>
        </div>
        
        {/* Vendor Selection Panel */}
        {showVendorSelection && allVendors && (
          <div className="mt-6 p-4 bg-white/70 rounded-lg border border-green-200 backdrop-blur-sm shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                <Filter className="h-4 w-4 text-green-500" />
                {t("selection.chooseVendorsHeading")}
              </h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllVendors} className="hover:bg-green-50">
                  {t("selection.selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllVendors} className="hover:bg-red-50">
                  {t("selection.clearAll")}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {allVendors.map(vendor => (
                <div key={vendor.id} className="flex items-center space-x-2 p-2 rounded-lg hover:bg-white/50 transition-colors">
                  <Checkbox
                    id={vendor.id}
                    checked={selectedVendors.has(vendor.id)}
                    onCheckedChange={() => toggleVendor(vendor.id)}
                    className="data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                  />
                  <label
                    htmlFor={vendor.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {vendor.name}
                  </label>
                </div>
              ))}
            </div>
            {selectedVendors.size === 0 && (
              <p className="text-sm text-amber-600 mt-3 flex items-center gap-2 p-2 bg-amber-50 rounded-lg">
                <Eye className="h-4 w-4" />
                {t("selection.selectAtLeastOne")}
              </p>
            )}
          </div>
        )}
      </CardHeader>
      
      <CardContent className="p-0">
        {categoryTranslationUnavailable(features) && (
          <p role="alert" className="px-4 py-2 text-sm text-amber-700">{t("categoryTranslationUnavailable")}</p>
        )}
        {vendors.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4">
              <Users className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">{t("empty.noVendorsSelectedHeading")}</p>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              {t("empty.chooseVendorsDescription")}
            </p>
            <Button
              variant="outline"
              onClick={() => setShowVendorSelection(true)}
              className="flex items-center gap-2 mx-auto hover:bg-green-50"
            >
              <Filter className="h-4 w-4" />
              {t("selection.filterVendors")}
            </Button>
          </div>
        ) : (
          <div className="relative">
            {/* Sticky header that moves with horizontal scroll - Hidden on mobile */}
            <div 
              ref={stickyHeaderRef}
              className={`sticky top-0 z-50 bg-white border-b border-gray-200 shadow-lg overflow-hidden ${isMobile ? 'hidden' : ''}`}>
              <div 
                className="grid gap-4 py-4 px-6" 
                style={{ 
                  gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                  minWidth: `${500 + (vendors.length * 140)}px`
                }}
              >
                <div className="font-semibold text-sm text-gray-700 flex items-center">
                  {t("table.features")}
                </div>
                <div className="font-semibold text-sm text-gray-700 flex items-center">
                  {t("table.evaluationCriteria")}
                </div>
                {vendors.map(vendor => (
                  <div key={vendor.id} className="text-center min-w-0">
                    <div className="font-medium text-sm text-gray-900 mb-1 truncate px-2">
                      {vendor.name}
                    </div>
                    {vendor.product && (
                      <div className="text-xs text-gray-600 font-medium truncate px-2">
                        {vendor.product}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Content with horizontal scrolling */}
            <div className={`${isMobile ? '' : 'overflow-x-auto'}`} ref={containerRef}>
              <div className={`${isMobile ? 'px-4 py-6' : 'px-6 pt-6 pb-6'} space-y-8`} style={{ minWidth: isMobile ? 'auto' : `${500 + (vendors.length * 140)}px` }}>
              {ecosystemFeatures && (() => {
                // Group features by category
                const featuresByCategory = ecosystemFeatures.reduce((acc, feature) => {
                  const categoryName = feature.category.name;
                  if (!acc[categoryName]) {
                    acc[categoryName] = {
                      category: feature.category,
                      features: []
                    };
                  }
                  acc[categoryName].features.push(feature);
                  return acc;
                }, {} as Record<string, { category: FeatureWithCategory['category'], features: FeatureWithCategory[] }>);

                // Sort categories by display order
                const sortedCategories = Object.values(featuresByCategory).sort(
                  (a, b) => a.category.displayOrder - b.category.displayOrder
                );

                return sortedCategories.map(({ category, features: categoryFeatures }) => {
                  const isCollapsed = collapsedCategories.has(category.id);
                  const categoryTotals = calculateCategoryTotals(categoryFeatures, vendors);

                  return (
                    <div key={category.id} className="space-y-4">
                      {/* Category header */}
                      <div className="py-4 bg-gradient-to-r from-gray-50 to-green-50/50 rounded-lg border border-gray-200 shadow-sm">
                        {isMobile ? (
                          <div className="px-4">
                            <button
                              onClick={() => toggleCategory(category.id)}
                              className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-green-600 transition-colors p-2 rounded-lg hover:bg-white/50 w-full justify-start"
                            >
                              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                              {featureCategoryName(category)}
                              <Badge variant="outline" className="ml-2 text-xs">
                                {t("evaluation.featureCount", { count: categoryFeatures.length })}
                              </Badge>
                            </button>
                          </div>
                        ) : (
                          <div 
                            className="grid gap-4 px-4" 
                            style={{ 
                              gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                              minWidth: `${500 + (vendors.length * 140)}px`
                            }}
                          >
                            <div className="flex items-center gap-3 col-span-2">
                              <button
                                onClick={() => toggleCategory(category.id)}
                                className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-green-600 transition-colors p-2 rounded-lg hover:bg-white/50"
                              >
                                {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                {featureCategoryName(category)}
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {t("evaluation.featureCount", { count: categoryFeatures.length })}
                                </Badge>
                              </button>
                            </div>

                            {/* Show totals when collapsed */}
                            {isCollapsed && vendors.map(vendor => {
                              const vendorTotal = categoryTotals.find(t => t.vendorId === vendor.id)?.total || 0;
                              return (
                                <div key={vendor.id} className="flex justify-center items-center">
                                  <div className="text-center p-2 bg-white/70 rounded-lg border border-green-200">
                                    <div className="font-bold text-lg text-green-700">
                                      {vendorTotal}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {t("scores.totalScore")}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Features in category */}
                      {!isCollapsed && (
                        <div className={`space-y-2 ${isMobile ? '' : 'ml-4'} animate-in slide-in-from-top-2 duration-200`}>
                          {categoryFeatures.map(feature => (
                            isMobile ? (
                              <div key={feature.id} className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="mb-3">
                                  <h4 className="font-medium text-gray-900 mb-1">{feature.name}</h4>
                                </div>
                                <div className="space-y-3">
                                  {vendors.map(vendor => {
                                    const supportKey = `${vendor.id}-${feature.id}`;
                                    const supportData = supportLookup.get(supportKey);
                                    const supportLevel = supportData?.level || 0;
                                    const notes = supportData?.notes;
                                    const isExpanded = mobileMode && expandedNoteKey === supportKey;
                                    
                                    const getSupportText = (level: number) => {
                                      switch (level) {
                                        case 0: return t("support.level.noSupport");
                                        case 1: return t("support.level.limited");
                                        case 2: return t("support.level.partial");
                                        case 3: return t("support.level.good");
                                        case 4: return t("support.level.fullSupport");
                                        default: return t("support.level.unknown");
                                      }
                                    };
                                    
                                    return (
                                      <div key={vendor.id} className="bg-gray-50 rounded-lg overflow-hidden">
                                        <div className="flex items-center justify-between p-3">
                                          <div>
                                            <div className="font-medium text-sm text-gray-900">{vendor.name}</div>
                                            <div className="text-xs text-gray-500">{getSupportText(supportLevel)}</div>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <HarveyBall
                                              level={supportLevel}
                                              notes={notes}
                                              vendorName={vendor.name}
                                              featureName={feature.name}
                                              onClick={() => handleHarveyBallClick(vendor.name, feature.name, supportLevel, notes, supportKey)}
                                              isMobile={true}
                                            />
                                            {mobileMode && <button type="button" className="min-h-11 px-2 text-[10px] font-bold text-sky-700" onClick={() => handleHarveyBallClick(vendor.name, feature.name, supportLevel, notes, supportKey)}>{t("notes.viewNotes")}</button>}
                                          </div>
                                        </div>
                                        {/* Inline expandable notes — replaces the desktop Dialog on mobile */}
                                        {isExpanded && (
                                          <div className="px-3 pb-3 pt-0 animate-in slide-in-from-top-1 duration-150">
                                            <div className="rounded-md bg-white border border-gray-200 p-3">
                                              <p className="text-xs font-medium text-gray-500 mb-1">{t("notes.notes")}</p>
                                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                                {notes || t("notes.noAdditionalNotes")}
                                              </p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <div 
                                key={feature.id}
                                className="grid gap-4 py-4 border-b border-gray-100 last:border-b-0 hover:bg-green-50/20 rounded-lg transition-colors px-2"
                                style={{ 
                                  gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                                  minWidth: `${500 + (vendors.length * 140)}px`
                                }}
                              >
                                <div className="flex flex-col justify-center">
                                  <div className="font-medium text-sm text-gray-900">
                                    {feature.name}
                                  </div>
                                </div>

                                <div className="flex flex-col justify-center">
                                  <div className="text-sm text-gray-700 leading-relaxed">
                                    {feature.description || t("evaluation.noCriteriaSpecified")}
                                  </div>
                                </div>
                                
                                {vendors.map(vendor => {
                                  const supportKey = `${vendor.id}-${feature.id}`;
                                  const supportData = supportLookup.get(supportKey) || { level: 0 };
                                  
                                  return (
                                    <div key={vendor.id} className="flex justify-center items-center">
                                      <HarveyBall 
                                        level={supportData.level}
                                        notes={supportData.notes}
                                        vendorName={vendor.name}
                                        featureName={feature.name}
                                        onClick={() => handleHarveyBallClick(vendor.name, feature.name, supportData.level, supportData.notes)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Total Score Row - Hidden on mobile */}
              {!isMobile && ecosystemFeatures && ecosystemFeatures.length > 0 && (() => {
                const maxScore = ecosystemFeatures.length;

                return (
                  <div className="mt-8 pt-6 border-t-2 border-gradient-to-r from-green-200 to-emerald-200 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow-sm" style={{ minWidth: `${500 + (vendors.length * 140)}px` }}>
                    <div 
                      className="grid gap-4 px-4 py-4" 
                      style={{ 
                        gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                        minWidth: `${500 + (vendors.length * 140)}px`
                      }}
                    >
                      <div className="flex flex-col justify-center col-span-2">
                        <div className="font-bold text-lg text-gray-900 flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-green-500" />
                          {t("scores.totalScore")}
                        </div>
                        <div className="text-sm text-gray-600">
                          {t("scores.maximumPoints", { count: maxScore })}
                        </div>
                      </div>
                      
                      {vendors.map(vendor => {
                        const vendorTotals = ecosystemTotals[vendor.id];
                        const totalScore = vendorTotals?.totalScore || 0;
                        const percentage = maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(1) : 0;
                        
                        return (
                          <div key={vendor.id} className="flex justify-center items-center">
                            <div className="text-center p-3 bg-white rounded-lg border-2 border-green-200 shadow-sm">
                              <div className="font-bold text-xl text-green-700">
                                {totalScore.toFixed(1)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {t("scores.ofMaximum", { maximum: maxScore, percentage })}
                              </div>
                              <div className="text-xs text-green-600 font-medium">
                                {t("scores.totalScore")}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Final Ecosystem Support Scores - Hidden on mobile */}
              {!isMobile && ecosystemFeatures && ecosystemFeatures.length > 0 && (
                <div className="mt-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow-sm" style={{ minWidth: `${500 + (vendors.length * 140)}px` }}>
                  <div 
                    className="grid gap-4 px-4 py-4" 
                    style={{ 
                      gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                      minWidth: `${500 + (vendors.length * 140)}px`
                    }}
                  >
                    <div className="flex flex-col justify-center col-span-2">
                      <div className="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" />
                        {t("scores.finalEcosystemSupport")}
                      </div>
                      <div className="text-sm text-gray-600">
                        {t("scores.finalScoreDescription")}
                      </div>
                    </div>
                    
                    {vendors.map(vendor => {
                      const derived = isvEcosystemScores.byVendor.get(vendor.id);
                      const coverageLabel = formatCoveragePercent(derived?.coverage);
                      
                      return (
                        <div key={vendor.id} className="flex justify-center items-center">
                          <div
                            className="text-center p-3 bg-white rounded-lg border-2 border-green-200 shadow-sm"
                            title={!derived
                              ? t("scores.tooltipNotDerived")
                              : !coverageLabel
                                ? t("scores.tooltipWithoutCoverage", { score: derived.score.toFixed(1) })
                                : t("scores.tooltipWithCoverage", {
                                    coverage: coverageLabel,
                                    features: derived.featureCount != null ? ` across ${derived.featureCount} features` : "",
                                    score: derived.score.toFixed(1),
                                  })}
                            data-testid={`derived-score-ecosystem-${vendor.id}`}
                          >
                            <div className="font-bold text-xl text-green-700">
                              {derived ? derived.score.toFixed(1) : "—"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {t("scores.outOfTen")}
                            </div>
                            <div className="text-xs text-green-600 font-medium">
                              {coverageLabel
                                ? t("scores.coverage", { coverage: coverageLabel })
                                : derived ? t("scores.ecosystemScore") : t("scores.notDerived")}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* Notes Modal */}
      <Dialog open={!!selectedNotes} onOpenChange={() => setSelectedNotes(null)}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("notes.detailsTitle")}
            </DialogTitle>
          </DialogHeader>
          {selectedNotes && (
            <div className="space-y-4 min-w-0">
              <div className="grid grid-cols-2 gap-4 min-w-0">
                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">{t("notes.vendor")}</label>
                  <p className="text-lg font-semibold break-words">{selectedNotes.vendorName}</p>
                </div>
                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">{t("table.feature")}</label>
                  <p className="text-lg font-semibold break-words">{selectedNotes.featureName}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg min-w-0">
                <HarveyBall 
                  level={selectedNotes.supportLevel} 
                  vendorName="" 
                  featureName="" 
                  onClick={() => {}} 
                />
                <div className="min-w-0">
                  <span className="font-medium">{getSupportText(selectedNotes.supportLevel)}</span>
                  <p className="text-sm text-gray-600">{t("notes.supportLevelLabel", { level: selectedNotes.supportLevel })}</p>
                </div>
              </div>
              
              <div className="min-w-0">
                <label className="text-sm font-medium text-gray-700 mb-2 block">{t("notes.notes")}</label>
                <div className="p-4 bg-white border rounded-lg min-h-[100px] text-sm text-gray-900 whitespace-pre-wrap break-words">
                  {selectedNotes.notes}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <VendorSelectionModal
        open={showVendorModal}
        onOpenChange={setShowVendorModal}
        vendors={allVendors || []}
        onGenerate={handleGenerateReport}
        title={t("reports.generateTitle")}
        description={t("reports.generateDescription")}
        isGenerating={isGenerating}
      />
    </Card>
  );
}