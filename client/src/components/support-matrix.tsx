import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Eye, ChevronDown, ChevronRight, FileText, RefreshCw, Filter, LayoutGrid, Info, Award, TrendingUp, Sparkles, FileDown, Lock, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { VendorSelectionModal } from "./vendor-selection-modal";
import { track } from "@/lib/track";
import { recordHighIntentAction } from "@/lib/high-intent";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport } from "@shared/schema";
import { formatCoveragePercent, getFeaturesForDerivedScore, supportLevelContribution } from "@shared/derived-feature-scores";
import { describeDerivedScore, useDerivedCriterionScores } from "@/hooks/use-derived-criterion-scores";

interface SupportMatrixProps {
  marketId: string;
  /** When true, anonymous visitors must register before generating a PDF report. */
  pdfLocked?: boolean;
  /** Called instead of opening the vendor-selection modal when pdfLocked is true. */
  onPdfLockedClick?: () => void;
  /** True only on the /mobile/* route — caps vendor selection at 2 (dense
   * comparison grids don't fit a phone) and uses the approved two-product
   * mobile comparison. Independent of the isMobile viewport hook. */
  mobileMode?: boolean;
}

const MOBILE_VENDOR_CAP = 2;

// Component for updating vendor evaluation scores from product evaluation
const UpdateVendorScoresButton = ({ marketId }: { marketId: string }) => {
  const { t } = useTranslation("supportMatrix");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateScoresMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/update-product-capabilities-scores", {
        method: "POST",
        body: JSON.stringify({ marketId }),
        headers: { "Content-Type": "application/json" }
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: t("toasts.scoresUpdated.title"),
        description: t("toasts.scoresUpdated.description", { count: data.updatedScores }),
      });
      // Invalidate vendor evaluation queries to refresh the visualization
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "vendors"] });
    },
    onError: (error: any) => {
      console.error("Error updating scores:", error);
      toast({
        title: t("toasts.updateFailed.title"),
        description: error.message || t("toasts.updateFailed.description"),
        variant: "destructive",
      });
    }
  });

  return (
    <Button
      onClick={() => updateScoresMutation.mutate()}
      disabled={updateScoresMutation.isPending}
      className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-md"
    >
      {updateScoresMutation.isPending ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {updateScoresMutation.isPending ? t("buttons.updating") : t("buttons.updateVendorEvaluation")}
    </Button>
  );
};

// Harvey Ball icons representing different support levels
const HarveyBall = ({ 
  level, 
  notes, 
  vendorName, 
  featureName, 
  onClick,
  isMobile = false,
  mobileContext
}: { 
  level: number; 
  notes?: string; 
  vendorName: string; 
  featureName: string; 
  onClick: () => void; 
  isMobile?: boolean;
  mobileContext?: any;
}) => {
  const { t } = useTranslation("supportMatrix");
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
      case 0: return t("supportLevels.none");
      case 1: return t("supportLevels.limited");
      case 2: return t("supportLevels.partial");
      case 3: return t("supportLevels.good");
      case 4: return t("supportLevels.full");
      default: return t("supportLevels.unknown");
    }
  };

  const {
    mobileMode = false,
    marketId,
    allVendors,
    selectedVendors,
    productCapabilityFeatures,
    pdfLocked,
    onPdfLockedClick,
    setShowVendorModal,
    toggleVendor,
    collapsedCategories,
    toggleCategory,
    supportLookup,
    selectedNotes,
    setSelectedNotes,
    showVendorModal,
    handleGenerateReport,
    isGenerating,
  } = mobileContext || {};

  if (mobileMode) {
    const selectedProducts: Vendor[] = ((allVendors ?? []) as Vendor[]).filter((vendor: Vendor) => selectedVendors.has(vendor.id));
    const featuresByCategory = (productCapabilityFeatures as FeatureWithCategory[]).reduce((acc: Record<string, { category: FeatureWithCategory["category"]; features: FeatureWithCategory[] }>, feature: FeatureWithCategory) => {
      const categoryId = feature.category.id;
      if (!acc[categoryId]) {
        acc[categoryId] = { category: feature.category, features: [] };
      }
      acc[categoryId].features.push(feature);
      return acc;
    }, {} as Record<string, { category: FeatureWithCategory["category"]; features: FeatureWithCategory[] }>);
    const sortedCategories: { category: FeatureWithCategory["category"]; features: FeatureWithCategory[] }[] = Object.values(featuresByCategory).sort(
      (a, b) => a.category.displayOrder - b.category.displayOrder,
    );
    const harveyFill = ["#e6e6e6", "#f7b51e", "#00b890", "#18bf72", "#13a8f0"];

    return (
      <Card className="overflow-hidden rounded-none border-[#dfe8ed] bg-white shadow-[0_5px_16px_rgba(15,20,24,0.06)]">
        <CardHeader className="border-b border-[#dfe8ed] bg-white px-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#13a8f0]">
                {t("mobile.eyebrow")}
              </p>
              <CardTitle className="mt-1 text-xl text-[#0f1418]">{t("mobile.title")}</CardTitle>
              <CardDescription className="mt-2 text-xs leading-5 text-[#66737b]">
                {t("mobile.description")}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (pdfLocked ? onPdfLockedClick?.() : setShowVendorModal(true))}
              className="hidden shrink-0 rounded-none border-[#dfe8ed] px-2 text-[11px]"
              data-testid="button-generate-product-evaluation-report"
            >
              {pdfLocked ? <Lock className="mr-1 h-3.5 w-3.5" /> : <FileDown className="mr-1 h-3.5 w-3.5" />}
              {t("buttons.pdf")}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-7 p-4">
          <section aria-labelledby="mobile-product-picker-title">
            <div className="flex items-end border-b border-[#dfe8ed] pb-2">
              <span className="mr-3 font-mono text-[10px] font-bold text-[#13a8f0]">01</span>
              <h2 id="mobile-product-picker-title" className="text-sm font-bold text-[#0f1418]">{t("mobile.productsToCompare")}</h2>
              <span className="ml-auto font-mono text-[9px] font-bold uppercase text-[#66737b]">{t("mobile.chooseExactlyTwo")}</span>
            </div>

            {allVendors && allVendors.length > 0 ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(allVendors as Vendor[]).map((vendor: Vendor) => {
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
                              metadata: { context: "product_evaluation", vendorName: vendor.name },
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
                              {vendor.product || t("fallbacks.productNameUnavailable")}
                            </small>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[#66737b]">
                  {selectedProducts.length === 2
                    ? t("mobile.twoProductsSelected")
                    : t(selectedProducts.length === 1 ? "mobile.moreProducts_one" : "mobile.moreProducts_other", { count: 2 - selectedProducts.length })}
                </p>
              </>
            ) : (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-4 text-center text-xs text-[#66737b]">
                {t("mobile.noProducts")}
              </div>
            )}

            <div className="mt-3 grid grid-cols-5 gap-1 border border-[#dfe8ed] bg-[#f7f9f9] p-2">
              {[
                `0 ${t("supportLevels.legendNone")}`,
                `1 ${t("supportLevels.legendLimited")}`,
                `2 ${t("supportLevels.legendPartial")}`,
                `3 ${t("supportLevels.legendGood")}`,
                `4 ${t("supportLevels.legendFull")}`,
              ].map((label, level) => (
                <span key={label} className="text-center font-mono text-[8px] uppercase text-[#66737b]">
                  <i className="mx-auto mb-1 block h-2 w-2 rounded-full" style={{ background: harveyFill[level] }} />
                  {label}
                </span>
              ))}
            </div>
          </section>

          <section aria-labelledby="mobile-product-support-title">
            <div className="flex items-end border-b border-[#dfe8ed] pb-2">
              <span className="mr-3 font-mono text-[10px] font-bold text-[#13a8f0]">02</span>
              <h2 id="mobile-product-support-title" className="text-sm font-bold text-[#0f1418]">
                {t("mobile.featureSupportCommentary")}
              </h2>
            </div>

            {selectedProducts.length !== MOBILE_VENDOR_CAP ? (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-5 text-center">
                <p className="text-xs font-bold text-[#0f1418]">{t("mobile.comparisonUnavailable")}</p>
                <p className="mt-1 text-[11px] text-[#66737b]">{t("mobile.chooseExactlyTwoAbove")}</p>
              </div>
            ) : sortedCategories.length === 0 ? (
              <div className="mt-3 border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-5 text-center text-xs text-[#66737b]">
                {t("mobile.noCapabilityFeatures")}
              </div>
            ) : (
              <div className="mt-3 border border-[#dfe8ed] bg-white">
                <div className="grid grid-cols-3 bg-[#0f1418] text-white">
                  <span className="border-r border-white/15 p-2 font-mono text-[9px] font-bold uppercase text-[#9bbbd0]">{t("matrix.feature")}</span>
                  {selectedProducts.map(vendor => (
                    <span key={vendor.id} className="border-r border-white/15 p-2">
                      <strong className="block break-words text-[11px] leading-4">{vendor.name}</strong>
                      <small className="mt-0.5 block break-words text-[9px] leading-3 text-[#bdd3d1]">
                        {vendor.product || t("fallbacks.productUnavailable")}
                      </small>
                    </span>
                  ))}
                </div>

                {sortedCategories.map(({ category, features: categoryFeatures }) => {
                  const isOpen = !collapsedCategories.has(category.id);
                  return (
                    <div key={category.id} className="border-t border-[#dfe8ed]">
                      <button
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        aria-expanded={isOpen}
                        aria-controls={`mobile-category-${category.id}`}
                        className="flex min-h-[54px] w-full items-center justify-between bg-[#e6f0f5] px-3 py-2 text-left"
                      >
                        <span>
                          <strong className="block text-xs text-[#0f1418]">{category.name}</strong>
                          <small className="mt-0.5 block text-[10px] text-[#66737b]">{t("mobile.storedRows", { count: categoryFeatures.length })}</small>
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>

                      {isOpen && (
                        <div id={`mobile-category-${category.id}`}>
                          {categoryFeatures.map(feature => (
                            <article key={feature.id} className="border-t border-[#dfe8ed] p-3">
                              <h3 className="text-xs font-bold text-[#0f1418]">{feature.name}</h3>
                              <p className="mb-2 mt-1 text-[11px] leading-[1.4] text-[#66737b]">
                                {feature.description || t("fallbacks.featureDescriptionUnavailable")}
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {selectedProducts.map(vendor => {
                                  const support = supportLookup.get(`${vendor.id}-${feature.id}`);
                                  const level = support?.level ?? 0;
                                  const unavailable = !support;
                                  return (
                                    <div key={vendor.id} className="border border-[#dfe8ed] bg-white p-2">
                                      <span className="mb-1.5 block break-words font-mono text-[9px] font-bold text-[#0f1418]">
                                        {vendor.name}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span
                                          role="img"
                                          aria-label={unavailable ? t("supportLevels.scoreUnavailable") : t("supportLevels.levelOfFour", { level })}
                                          className={`block h-7 w-7 shrink-0 rounded-full border-[2px] ${unavailable ? "border-dashed border-[#b9cbd5]" : "border-[#00b890]"}`}
                                          style={unavailable ? undefined : {
                                            background: `conic-gradient(#00b890 ${level * 25}%, #e6e6e6 0)`,
                                            boxShadow: "inset 0 0 0 3px #fff",
                                          }}
                                        />
                                        <b className="font-mono text-[10px] text-[#087fca]">
                                          {unavailable ? t("supportLevels.unavailable") : `${level} / 4`}
                                        </b>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedNotes({
                                          vendorName: vendor.name,
                                          productName: vendor.product || t("fallbacks.productNameUnavailable"),
                                          featureName: feature.name,
                                          supportLevel: level,
                                          unavailable,
                                          notes: unavailable
                                            ? t("fallbacks.noSupportRecord")
                                            : support.notes || t("fallbacks.noStoredCommentary"),
                                        })}
                                        className="mt-2 min-h-9 w-full border border-[#b9d8ec] bg-[#dcebf6] px-1 text-[10px] font-bold text-[#087fca]"
                                      >
                                        {t("buttons.viewNotes")}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
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
              <>
                <div className="grid grid-cols-2 border-b border-[#dfe8ed] bg-[#f7f9f9] text-xs">
                  <div className="border-r border-[#dfe8ed] p-3">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#66737b]">{t("notes.vendor")}</span>
                    <strong className="mt-1 block">{selectedNotes.vendorName}</strong>
                  </div>
                  <div className="p-3">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#66737b]">{t("notes.product")}</span>
                    <strong className="mt-1 block break-words">{selectedNotes.productName}</strong>
                  </div>
                  <div className="col-span-2 border-t border-[#dfe8ed] p-3">
                    <span className="font-mono text-[9px] font-bold uppercase text-[#66737b]">{t("notes.support")}</span>
                    <strong className="mt-1 block">
                      {selectedNotes.unavailable
                        ? t("supportLevels.unavailable")
                        : `${selectedNotes.supportLevel} / 4 · ${getSupportText(selectedNotes.supportLevel)}`}
                    </strong>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <span className="font-mono text-[9px] font-bold uppercase text-[#66737b]">{t("notes.storedCommentary")}</span>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#3f4d55]">{selectedNotes.notes}</p>
                </div>
                <div className="border-t border-[#dfe8ed] p-3">
                  <Button className="min-h-11 w-full rounded-none bg-[#0f1418] text-white hover:bg-[#27323a]" onClick={() => setSelectedNotes(null)}>
                    {t("buttons.closeNotes")}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <VendorSelectionModal
          open={showVendorModal}
          onOpenChange={setShowVendorModal}
          vendors={allVendors || []}
          onGenerate={handleGenerateReport}
          title={t("reports.title")}
          description={t("reports.description")}
          isGenerating={isGenerating}
        />
      </Card>
    );
  }

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={onClick}
        className={`${isMobile ? 'text-3xl p-2' : 'text-2xl p-1'} ${getHarveyBallColor(level)} hover:scale-125 transition-all duration-200 cursor-pointer relative group shadow-sm hover:shadow-md rounded-full ${isMobile ? 'min-w-[44px] min-h-[44px]' : ''}`}
        title={notes
          ? t("supportLevels.tooltipWithNotes", { support: getSupportText(level) })
          : getSupportText(level)}
      >
        {getHarveyBallIcon(level)}
        {notes && (
          <FileText className={`absolute -top-1 -right-1 text-blue-600 opacity-75 ${isMobile ? 'h-4 w-4' : 'h-3 w-3'}`} />
        )}
      </button>
    </div>
  );
};

export default function SupportMatrix({ marketId, pdfLocked, onPdfLockedClick, mobileMode = false }: SupportMatrixProps) {
  const { t, i18n } = useTranslation("supportMatrix");
  // Refs for scroll synchronization
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);

  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [showVendorSelection, setShowVendorSelection] = useState(true); // Show selection by default
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [categoriesInitialized, setCategoriesInitialized] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<{
    vendorName: string;
    productName: string;
    featureName: string;
    notes: string;
    supportLevel: number;
    unavailable?: boolean;
  } | null>(null);
  const [expandedNoteKey] = useState<string | null>(null);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Mobile detection
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const { data: features, isLoading: featuresLoading } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: allVendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", marketId, "feature-support", i18n.language],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/feature-support?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  // Persisted Product Capabilities scores (derived server-side from this
  // matrix); the score row below reads these rather than recomputing.
  const productCapabilityScores = useDerivedCriterionScores(marketId, "productCapabilities");

  const isLoading = featuresLoading || vendorsLoading || supportLoading;

  // Handler for generating product evaluation report
  const handleGenerateReport = async (selectedVendorIds: string[]) => {
    setIsGenerating(true);
    try {
      const response = await apiRequest(
        `/api/markets/${marketId}/generate-product-evaluation-pdf`,
        "POST",
        { vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined }
      );

      if (!response.ok) {
        throw new Error(t("toasts.reportFailed.description"));
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : 'Spectio Product Evaluation Report.pdf';
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
        title: t("toasts.reportSuccess.title"),
        description: t("toasts.reportSuccess.description"),
      });

      setShowVendorModal(false);
    } catch (error) {
      console.error("Error generating report:", error);
      toast({
        title: t("toasts.reportFailed.title"),
        description: t("toasts.reportFailed.description"),
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Do not auto-select vendors - require user selection (matches Ecosystem Support tab)

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
            metadata: { context: "product_evaluation", vendorName: v.name },
          }),
        );
      if (selectedVendors.size >= 2) {
        recordHighIntentAction("product_comparison_opened", {
          marketId,
          metadata: { vendorCount: selectedVendors.size },
        });
      }
      setShowVendorSelection(false);
    }
  };

  // Same partition the persisted Product Capabilities score is derived from
  // (shared/derived-feature-scores.ts), so this tab always matches the chart.
  const productCapabilityFeatures = features
    ? (getFeaturesForDerivedScore(features, "productCapabilities") as FeatureWithCategory[])
    : [];

  const toggleVendor = (vendorId: string) => {
    setSelectedVendors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(vendorId)) {
        newSet.delete(vendorId);
      } else {
        if (mobileMode && newSet.size >= MOBILE_VENDOR_CAP) {
          toast({
            title: t("toasts.chooseTwoProducts.title"),
            description: t("toasts.chooseTwoProducts.description"),
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
    if (productCapabilityFeatures) {
      const uniqueCategoryIds = new Set(productCapabilityFeatures.map(f => f.category.id));
      setCollapsedCategories(uniqueCategoryIds);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-500" />
            {t("heading.productEvaluation")}
          </CardTitle>
          <CardDescription>{t("loading.description")}</CardDescription>
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
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-500" />
            {t("heading.productEvaluation")}
          </CardTitle>
          <CardDescription>{t("selection.description")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {allVendors && allVendors.length > 0 ? (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("selection.chooseVendors")}</h3>
                <p className="text-gray-600 mb-4">{t("selection.chooseVendorsDescription")}</p>
              </div>
              
              <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                {allVendors.map(vendor => (
                  <div 
                    key={vendor.id} 
                    className={`border rounded-lg ${isMobile ? 'p-4' : 'p-4'} cursor-pointer transition-all duration-200 ${
                      selectedVendors.has(vendor.id) 
                        ? 'border-blue-500 bg-blue-50 shadow-md' 
                        : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
                    }`}
                    onClick={() => toggleVendor(vendor.id)}
                    data-testid={`vendor-card-${vendor.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className={`font-semibold text-gray-900 ${isMobile ? 'text-base' : ''}`}>{vendor.name}</h4>
                        {vendor.product && (
                          <p className={`text-gray-600 mt-1 ${isMobile ? 'text-sm' : 'text-sm'}`}>{vendor.product}</p>
                        )}
                      </div>
                      <div className={`rounded border-2 flex items-center justify-center ${
                        isMobile ? 'w-6 h-6' : 'w-5 h-5'
                      } ${
                        selectedVendors.has(vendor.id)
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300'
                      }`}>
                        {selectedVendors.has(vendor.id) && (
                          <svg className={`text-white ${isMobile ? 'w-4 h-4' : 'w-3 h-3'}`} fill="currentColor" viewBox="0 0 20 20">
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
                    : t(selectedVendors.size === 1 ? "selection.vendorsSelected_one" : "selection.vendorsSelected_other", { count: selectedVendors.size })}
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedVendors(new Set())}
                    disabled={selectedVendors.size === 0}
                    data-testid="clear-vendors-button"
                  >
                    {t("buttons.clearAll")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={selectAllVendors}
                    data-testid="select-all-vendors-button"
                  >
                    {t("buttons.selectAll")}
                  </Button>
                  <Button
                    onClick={handleProceedWithSelection}
                    disabled={selectedVendors.size === 0 || (mobileMode && selectedVendors.size !== MOBILE_VENDOR_CAP)}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="proceed-with-selection-button"
                  >
                    {mobileMode
                      ? t("buttons.compareProducts", { count: selectedVendors.size })
                      : t("buttons.viewProductEvaluation", { count: selectedVendors.size })}
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

  if (!productCapabilityFeatures || !vendors || !supportMatrix) {
    return (
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-500" />
            {t("heading.productEvaluation")}
          </CardTitle>
          <CardDescription>{t("loading.capabilitiesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-gray-500">{t("matrix.noCapabilityFeatures")}</p>
        </CardContent>
      </Card>
    );
  }

  // Create support lookup map with notes
  const supportLookup = new Map<string, { level: number; notes?: string }>();
  supportMatrix.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, { 
      level: support.supportLevel, 
      notes: support.comments || undefined 
    });
  });

  const handleHarveyBallClick = (vendorName: string, productName: string, featureName: string, supportLevel: number, notes?: string) => {
    if (mobileMode) {
      setSelectedNotes({ vendorName, productName, featureName, supportLevel, notes: notes || t("fallbacks.noStoredCommentary") });
      return;
    }
    if (notes) {
      setSelectedNotes({
        vendorName,
        productName,
        featureName, 
        notes,
        supportLevel
      });
    }
  };

  // Calculate support level score. Delegates to the shared roll-up used for
  // persisted Product Capabilities / ISV Ecosystem criterion scores, so this
  // category "Total Score" always matches (Limited support = 0.25).
  const getSupportScore = (level: number) => supportLevelContribution(level);

  // Calculate category totals for each vendor
  const calculateCategoryTotals = (categoryFeatures: FeatureWithCategory[], vendors: Vendor[]) => {
    return vendors.map(vendor => {
      const total = categoryFeatures.reduce((sum, feature) => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const supportData = supportLookup.get(supportKey) || { level: 0 };
        return sum + getSupportScore(supportData.level);
      }, 0);
      return { vendorId: vendor.id, total: Number(total.toFixed(2)) };
    });
  };

  // Calculate overall totals across all features for each vendor
  const calculateOverallTotals = (allFeatures: FeatureWithCategory[], vendors: Vendor[]) => {
    return vendors.map(vendor => {
      const total = allFeatures.reduce((sum, feature) => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const supportData = supportLookup.get(supportKey) || { level: 0 };
        return sum + getSupportScore(supportData.level);
      }, 0);
      return { vendorId: vendor.id, total: Number(total.toFixed(2)) };
    });
  };

  // Calculate maximum possible score (all features at full support)
  const calculateMaximumScore = (allFeatures: FeatureWithCategory[]) => {
    return allFeatures.length * 1.0; // 1.0 is the score for full support
  };

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return t("supportLevels.none");
      case 1: return t("supportLevels.limited");
      case 2: return t("supportLevels.partial");
      case 3: return t("supportLevels.good");
      case 4: return t("supportLevels.full");
      default: return t("supportLevels.unknown");
    }
  };

  if (mobileMode) {
    return (
      <HarveyBall
        level={0}
        vendorName=""
        featureName=""
        onClick={() => {}}
        mobileContext={{
          mobileMode,
          marketId,
          allVendors,
          selectedVendors,
          productCapabilityFeatures,
          pdfLocked,
          onPdfLockedClick,
          setShowVendorModal,
          toggleVendor,
          collapsedCategories,
          toggleCategory,
          supportLookup,
          selectedNotes,
          setSelectedNotes,
          showVendorModal,
          handleGenerateReport,
          isGenerating,
        }}
      />
    );
  }

  return (
    <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg shadow-md">
                <LayoutGrid className="h-5 w-5 text-white" />
              </div>
              {t("heading.productEvaluation")}
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 shadow-sm">
                <Award className="h-3 w-3 mr-1" />
                {t("heading.vendorCount", { selected: vendors.length, total: allVendors?.length || 0 })}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-4 flex-wrap mt-3">
              <span className="text-gray-600 flex items-center gap-2">
                <Info className="h-4 w-4" />
                {t("heading.capabilitiesOnly")}
              </span>
              <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg border border-white/40 backdrop-blur-sm">
                <div className="flex items-center gap-1">
                  <span className="text-green-500 text-lg font-bold">●</span>
                  <span className="text-xs font-medium">{t("supportLevels.legendFull")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-blue-500 text-lg font-bold">◕</span>
                  <span className="text-xs font-medium">{t("supportLevels.legendGood")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-500 text-lg font-bold">◑</span>
                  <span className="text-xs font-medium">{t("supportLevels.legendPartial")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-orange-500 text-lg font-bold">◔</span>
                  <span className="text-xs font-medium">{t("supportLevels.legendLimited")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-lg font-bold">○</span>
                  <span className="text-xs font-medium">{t("supportLevels.legendNone")}</span>
                </div>
              </div>
            </CardDescription>
          </div>
          <div className={`flex items-center gap-3 ${isMobile ? 'flex-col gap-2 w-full' : ''}`}>
            <div className={`flex items-center gap-2 ${isMobile ? 'w-full flex-wrap' : ''}`}>
              <Button
                onClick={() => (pdfLocked ? onPdfLockedClick?.() : setShowVendorModal(true))}
                variant="outline"
                size={isMobile ? "default" : "sm"}
                className={`hidden items-center gap-2 transition-all duration-200 ${pdfLocked ? 'text-muted-foreground' : 'hover:bg-blue-50 hover:border-blue-300'} ${isMobile ? 'flex-1 min-w-[120px]' : ''}`}
                data-testid="button-generate-product-evaluation-report"
              >
                {pdfLocked ? <Lock className="h-4 w-4" /> : <FileDown className="h-4 w-4" />}
                {isMobile ? t("buttons.pdf") : t("buttons.pdfReport")}
              </Button>
              <Button
                variant="outline"
                size={isMobile ? "default" : "sm"}
                onClick={() => setShowVendorSelection(true)}
                className={`flex items-center gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 ${isMobile ? 'flex-1 min-w-[120px]' : ''}`}
                data-testid="back-to-vendor-selection-button"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
                {isMobile ? t("buttons.change") : t("buttons.changeSelection")}
              </Button>
              
              <Button
                variant="outline"
                size={isMobile ? "default" : "sm"}
                onClick={expandAllCategories}
                className={`flex items-center gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 ${isMobile ? 'flex-1 min-w-[120px]' : ''}`}
              >
                <ChevronDown className="h-4 w-4" />
                {t("buttons.expandAll")}
              </Button>
              
              <Button
                variant="outline"
                size={isMobile ? "default" : "sm"}
                onClick={collapseAllCategories}
                className={`flex items-center gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 ${isMobile ? 'flex-1 min-w-[120px]' : ''}`}
              >
                <ChevronRight className="h-4 w-4" />
                {t("buttons.collapseAll")}
              </Button>
            </div>
            
            <Button
              variant={showVendorSelection ? "default" : "outline"}
              size={isMobile ? "default" : "sm"}
              onClick={() => setShowVendorSelection(!showVendorSelection)}
              className={`flex items-center gap-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-md transition-all duration-200 ${isMobile ? 'w-full' : ''}`}
            >
              <Filter className="h-4 w-4" />
              {showVendorSelection ? t("buttons.hideFilters") : t("buttons.filterVendors")}
            </Button>
          </div>
        </div>
        
        {/* Vendor Selection Panel */}
        {showVendorSelection && allVendors && (
          <div className="mt-6 p-4 bg-white/70 rounded-lg border border-blue-200 backdrop-blur-sm shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-500" />
                {t("selection.chooseVendorsToCompare")}
              </h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllVendors} className="hover:bg-blue-50">
                  {t("buttons.selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllVendors} className="hover:bg-red-50">
                  {t("buttons.clearAll")}
                </Button>
              </div>
            </div>
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
              {allVendors.map(vendor => (
                <div key={vendor.id} className={`flex items-center space-x-2 ${isMobile ? 'p-3' : 'p-2'} rounded-lg hover:bg-white/50 transition-colors ${isMobile ? 'min-h-[48px]' : ''}`}>
                  <Checkbox
                    id={vendor.id}
                    checked={selectedVendors.has(vendor.id)}
                    onCheckedChange={() => toggleVendor(vendor.id)}
                    className={`data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 ${isMobile ? 'w-5 h-5' : ''}`}
                  />
                  <label
                    htmlFor={vendor.id}
                    className={`font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer ${isMobile ? 'text-base' : 'text-sm'}`}
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
        {vendors.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4">
              <Users className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">{t("matrix.noVendorsSelected")}</p>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              {t("matrix.chooseVendorsToCompare")}
            </p>
            <Button
              variant="outline"
              onClick={() => setShowVendorSelection(true)}
              className="flex items-center gap-2 mx-auto hover:bg-blue-50"
            >
              <Filter className="h-4 w-4" />
              {t("buttons.filterVendors")}
            </Button>
          </div>
        ) : (
          <div className="relative">
            {/* Sticky header that moves with horizontal scroll */}
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
                  {t("matrix.features")}
                </div>
                <div className="font-semibold text-sm text-gray-700 flex items-center">
                  {t("matrix.evaluationCriteria")}
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
              <div className={`${isMobile ? 'px-4 py-6' : 'px-6 pt-6'} space-y-8`} style={{ minWidth: isMobile ? 'auto' : `${500 + (vendors.length * 140)}px` }}>
              {productCapabilityFeatures && (() => {
                // Group features by category
                const featuresByCategory = productCapabilityFeatures.reduce((acc, feature) => {
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
                      <div className="py-4 bg-gradient-to-r from-gray-50 to-blue-50/50 rounded-lg border border-gray-200 shadow-sm">
                        {isMobile ? (
                          <div className="px-4">
                            <button
                              onClick={() => toggleCategory(category.id)}
                              className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-white/50 w-full justify-start"
                            >
                              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                              {category.name}
                              <Badge variant="outline" className="ml-2 text-xs">
                                {t("matrix.featureCount", { count: categoryFeatures.length })}
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
                                className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-white/50"
                              >
                                {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                {category.name}
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {t("matrix.featureCount", { count: categoryFeatures.length })}
                                </Badge>
                              </button>
                            </div>
                            
                            {/* Show totals when collapsed */}
                            {isCollapsed && vendors.map(vendor => {
                              const vendorTotal = categoryTotals.find(t => t.vendorId === vendor.id)?.total || 0;
                              return (
                                <div key={vendor.id} className="flex justify-center items-center">
                                  <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-200">
                                    <div className="font-bold text-lg text-blue-700">
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
                                    <p className="text-sm text-gray-600">{feature.description || t("fallbacks.noEvaluationCriteria")}</p>
                                </div>
                                <div className="space-y-3">
                                  {vendors.map(vendor => {
                                    const supportKey = `${vendor.id}-${feature.id}`;
                                    const supportData = supportLookup.get(supportKey);
                                    const supportLevel = supportData?.level || 0;
                                    const notes = supportData?.notes;
                                    const isExpanded = mobileMode && expandedNoteKey === supportKey;

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
                                              onClick={() => handleHarveyBallClick(vendor.name, vendor.product || t("fallbacks.productNameUnavailable"), feature.name, supportLevel, notes)}
                                              isMobile={true}
                                            />
                                            {mobileMode && <button type="button" className="min-h-11 px-2 text-[10px] font-bold text-sky-700" onClick={() => handleHarveyBallClick(vendor.name, vendor.product || t("fallbacks.productNameUnavailable"), feature.name, supportLevel, notes)}>{t("buttons.viewNotes")}</button>}
                                          </div>
                                        </div>
                                        {/* Inline expandable notes — replaces the desktop Dialog on mobile */}
                                        {isExpanded && (
                                          <div className="px-3 pb-3 pt-0 animate-in slide-in-from-top-1 duration-150">
                                            <div className="rounded-md bg-white border border-gray-200 p-3">
                                              <p className="text-xs font-medium text-gray-500 mb-1">{t("notes.notes")}</p>
                                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                                {notes || t("fallbacks.noAdditionalNotes")}
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
                                className="grid gap-4 py-4 border-b border-gray-100 last:border-b-0 hover:bg-blue-50/20 rounded-lg transition-colors px-2"
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
                                  {feature.description || t("fallbacks.noEvaluationCriteria")}
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
                                      onClick={() => handleHarveyBallClick(vendor.name, vendor.product || t("fallbacks.productNameUnavailable"), feature.name, supportData.level, supportData.notes)}
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

              {/* Total Score Row */}
              {productCapabilityFeatures && productCapabilityFeatures.length > 0 && (() => {
                const overallTotals = calculateOverallTotals(productCapabilityFeatures, vendors);
                const maxScore = calculateMaximumScore(productCapabilityFeatures);
                
                return (
                  <div className="mt-8 pt-6 border-t-2 border-gradient-to-r from-blue-200 to-purple-200 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-sm" style={{ minWidth: `${500 + (vendors.length * 140)}px` }}>
                    <div 
                      className="grid gap-4 py-4 px-4" 
                      style={{ 
                        gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                        width: `${500 + (vendors.length * 140)}px`
                      }}
                    >
                      <div className="flex flex-col justify-center col-span-2">
                        <div className="font-bold text-lg text-gray-900 flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-blue-500" />
                          {t("scores.totalScore")}
                        </div>
                        <div className="text-sm text-gray-600">
                          {t("scores.maximumPoints", { maxScore })}
                        </div>
                      </div>
                      
                      {vendors.map(vendor => {
                        const vendorTotal = overallTotals.find(t => t.vendorId === vendor.id)?.total || 0;
                        const percentage = maxScore > 0 ? ((vendorTotal / maxScore) * 100).toFixed(1) : 0;
                        
                        return (
                          <div key={vendor.id} className="flex justify-center items-center">
                            <div className="text-center p-3 bg-white rounded-lg border-2 border-blue-200 shadow-sm">
                              <div className="font-bold text-xl text-blue-700">
                                {vendorTotal}
                              </div>
                              <div className="text-xs text-gray-500">
                                {percentage}%
                              </div>
                              <div className="text-xs text-blue-600 font-medium">
                                  {t("scores.ofMaximum", { maxScore })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Product Capabilities criterion (persisted 0–10 rubric score) */}
              {productCapabilityFeatures && productCapabilityFeatures.length > 0 && (() => {
                return (
                  <div className="mt-4 pt-6 border-t-2 border-gradient-to-r from-purple-200 to-blue-200 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow-sm" style={{ minWidth: `${500 + (vendors.length * 140)}px` }}>
                    <div 
                      className="grid gap-4 py-4 px-4" 
                      style={{ 
                        gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                        width: `${500 + (vendors.length * 140)}px`
                      }}
                    >
                      <div className="flex flex-col justify-center col-span-2">
                        <div className="font-bold text-lg text-gray-900 flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-purple-500" />
                          {t("scores.productCapabilitiesScore")}
                        </div>
                        <div className="text-sm text-gray-600">
                          {t("scores.criterionDescription")}
                        </div>
                      </div>
                      
                      {vendors.map(vendor => {
                        const derived = productCapabilityScores.byVendor.get(vendor.id);
                        const coverageLabel = formatCoveragePercent(derived?.coverage);
                        
                        return (
                          <div key={vendor.id} className="flex justify-center items-center">
                            <div
                              className="text-center p-3 bg-white rounded-lg border-2 border-purple-200 shadow-sm"
                              title={describeDerivedScore("productCapabilities", derived)}
                              data-testid={`derived-score-product-${vendor.id}`}
                            >
                              <div className="font-bold text-xl text-purple-700">
                                {derived ? derived.score.toFixed(1) : "—"}
                              </div>
                              <div className="text-xs text-gray-500">
                                {t("scores.outOfTen")}
                              </div>
                              <div className="text-xs text-purple-600 font-medium">
                                {coverageLabel ? t("scores.coverage", { coverage: coverageLabel }) : derived ? t("scores.productScore") : t("scores.notDerivedYet")}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
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
              {t("notes.featureSupportDetails")}
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
                  <label className="text-sm font-medium text-gray-700">{t("notes.feature")}</label>
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
                  <p className="text-sm text-gray-600">{t("notes.supportLevel", { level: selectedNotes.supportLevel })}</p>
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
        title={t("reports.title")}
        description={t("reports.description")}
        isGenerating={isGenerating}
      />
    </Card>
  );
}