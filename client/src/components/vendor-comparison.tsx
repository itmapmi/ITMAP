import { Fragment, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import MarketSectionHeader from "@/components/market-section-header";
import VendorComparisonNotes from "@/components/vendor-comparison-notes";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, ChevronDown, Download, FileText, Users } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MobileNotesCloseButton from "@/components/mobile-notes-close-button";
import type { Vendor, VendorScore, Criteria } from "@shared/schema";
import { recordHighIntentAction } from "@/lib/high-intent";
import { useTranslation } from "react-i18next";
import { translateCriterionName } from "@/lib/criteria-i18n";

interface VendorComparisonProps {
  marketId: string;
  mobileMode?: boolean;
  mobileSelectedVendors?: string[];
  onMobileSelectedVendorsChange?: (vendorIds: string[]) => void;
}

export default function VendorComparison({ marketId, mobileMode = false, mobileSelectedVendors, onMobileSelectedVendorsChange }: VendorComparisonProps) {
  const { t, i18n } = useTranslation("magicQuadrant");
  const { t: tc } = useTranslation("common");
  const [localSelectedVendors, setLocalSelectedVendors] = useState<string[]>([]);
  const selectedVendors = mobileMode && mobileSelectedVendors ? mobileSelectedVendors : localSelectedVendors;
  const setSelectedVendors = (updater: (previous: string[]) => string[]) => {
    const next = updater(selectedVendors);
    if (mobileMode && onMobileSelectedVendorsChange) onMobileSelectedVendorsChange(next);
    else setLocalSelectedVendors(next);
  };
  const [mobileNote, setMobileNote] = useState<{ vendor: Vendor; criterion: Criteria; score: number; notes: string } | null>(null);
  const [expandedDesktopNotes, setExpandedDesktopNotes] = useState<Set<string>>(new Set());
  const [expandedMobileCriterion, setExpandedMobileCriterion] = useState<string | null>(null);
  const mobileScoresRef = useRef<HTMLElement>(null);
  const previousMobileSelectionCount = useRef(0);
  const pendingMobileScoresScroll = useRef(false);
  const isMobile = useIsMobile();

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: scores, isLoading: scoresLoading } = useQuery<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>({
    queryKey: ["/api/markets", marketId, "scores", i18n.language],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/scores?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const { data: criteria, isLoading: criteriaLoading } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  const handleVendorToggle = (vendorId: string, checked: boolean) => {
    if (checked) {
      // Mobile caps the comparison at three so the side-by-side grid stays legible.
      setSelectedVendors(prev => mobileMode && prev.length >= 3 ? prev : [...prev, vendorId]);
    } else {
      // No minimum: the user may uncheck anything, including the last one.
      setSelectedVendors(prev => prev.filter(id => id !== vendorId));
    }
  };

  const getVendorScore = (vendorId: string, criteriaId: string): number => {
    // All eight criteria, including the feature-derived Product Capabilities
    // and ISV Ecosystem, are read as persisted on the vendor score row.
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score?.score ? parseFloat(score.score.toString()) : 0;
  };

  const getVendorNotes = (vendorId: string, criteriaId: string): string => {
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score?.notes || "";
  };

  const selectedVendorData = vendors?.filter(vendor => selectedVendors.includes(vendor.id)) || [];
  const mobileSelectionCount = selectedVendorData.length;
  const mobileEvidenceLoading = scoresLoading || criteriaLoading;

  const renderDesktopNotes = (criterion: Criteria) => (
    <VendorComparisonNotes
      criterion={criterion}
      entries={selectedVendorData.map(vendor => ({
        vendor,
        score: getVendorScore(vendor.id, criterion.id),
        notes: getVendorNotes(vendor.id, criterion.id),
      }))}
    />
  );

  useEffect(() => {
    setExpandedDesktopNotes(new Set());
    setExpandedMobileCriterion(null);
    previousMobileSelectionCount.current = 0;
    pendingMobileScoresScroll.current = false;
  }, [marketId]);

  useEffect(() => {
    if (selectedVendors.length < 2) setExpandedDesktopNotes(new Set());
  }, [selectedVendors.length]);

  const toggleDesktopNotes = (criterionId: string) => {
    setExpandedDesktopNotes(previous => {
      const next = new Set(previous);
      if (next.has(criterionId)) next.delete(criterionId);
      else next.add(criterionId);
      return next;
    });
  };

  useEffect(() => {
    if (!mobileMode) return;
    const reachedComparison = previousMobileSelectionCount.current < 2 && mobileSelectionCount >= 2;
    const evidenceArrived = pendingMobileScoresScroll.current && !mobileEvidenceLoading;
    if (mobileSelectionCount >= 2 && (reachedComparison || evidenceArrived)) {
      pendingMobileScoresScroll.current = mobileEvidenceLoading;
      mobileScoresRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }
    if (mobileSelectionCount < 2) {
      pendingMobileScoresScroll.current = false;
      setExpandedMobileCriterion(null);
    }
    previousMobileSelectionCount.current = mobileSelectionCount;
  }, [mobileMode, mobileSelectionCount, mobileEvidenceLoading]);

  const toggleMobileCriterion = (criterionId: string, button: HTMLButtonElement) => {
    const switchingCriterion = expandedMobileCriterion !== null && expandedMobileCriterion !== criterionId;
    setExpandedMobileCriterion(previous => previous === criterionId ? null : criterionId);
    if (switchingCriterion) {
      requestAnimationFrame(() => button.scrollIntoView({ block: "start", inline: "nearest" }));
    }
  };

  // NOTE: the mobile default selection is seeded once by the owner of the
  // shared selection state (magic-quadrant.tsx). It must not be re-seeded
  // here whenever the list becomes empty, or the user can never clear it.

  // Record a comparison once the user settles on 2+ vendors. Debounced so a
  // run of checkbox toggles produces one event, and de-duplicated so the same
  // selection set isn't recorded twice in a session.
  const lastRecordedRef = useRef<string>("");
  useEffect(() => {
    if (selectedVendors.length < 2) return;
    const signature = [...selectedVendors].sort().join(",");
    if (signature === lastRecordedRef.current) return;
    const timer = setTimeout(() => {
      lastRecordedRef.current = signature;
      fetch(`/api/markets/${marketId}/track-vendor-comparison`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: true,
        body: JSON.stringify({ vendorIds: [...selectedVendors] }),
      }).catch(() => {
        // Best-effort tracking — never disrupt the comparison experience.
      });
      // Anonymous-safe beacon (the fetch above requires auth and silently
      // no-ops for anonymous ad visitors — the exact audience the
      // registration teaser's high-intent grace period targets).
      recordHighIntentAction("vendor_comparison_opened", {
        marketId,
        metadata: { vendorCount: selectedVendors.length },
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [selectedVendors, marketId]);

  if (mobileMode) {
    const atMax = selectedVendors.length >= 3;
    return (
      <section className="space-y-5 font-[Montserrat]">
        <div>
          <div className="mb-2 flex items-end justify-between border-b border-slate-200 pb-2">
            <div><p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">02</p><h3 className="text-base font-bold">{t("compare.mobileTitle")}</h3></div>
            <span className="font-[Menlo] text-[10px] uppercase tracking-wider text-slate-500">{t("compare.mobileSelectedCount", { count: selectedVendors.length })}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {vendors?.map(vendor => {
              const active = selectedVendors.includes(vendor.id);
              return (
                <button key={vendor.id} type="button" onClick={() => handleVendorToggle(vendor.id, !active)} disabled={!active && atMax} className={`flex min-h-20 items-start gap-2 border p-2 text-left transition-colors ${active ? "border-[#13a8f0] bg-[#dcebf6] text-[#0f1418] shadow-[inset_3px_0_#13a8f0]" : "border-[#dfe8ed] bg-white text-[#66737b]"} ${!active && atMax ? "opacity-50" : ""}`} aria-pressed={active} data-testid={`mobile-compare-vendor-${vendor.id}`}>
                  <span className={`grid h-[21px] w-[21px] shrink-0 place-items-center border ${active ? "border-[#13a8f0] bg-[#13a8f0] text-white" : "border-[#b9cbd5]"}`}>{active && <Check className="h-3 w-3" aria-hidden="true" />}</span>
                  <span className="min-w-0"><strong className="block break-words text-xs leading-4">{vendor.name}</strong><small className="mt-1 block break-words text-[10px] leading-[1.3] text-[#66737b]">{vendor.product || t("compare.productNameUnavailable")}</small></span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {selectedVendorData.length === 0
              ? t("compare.mobileSelectPrompt")
              : atMax
                ? t("compare.mobileMaxSelected")
                : t("compare.mobileSelectHint")}
          </p>
        </div>
        {selectedVendorData.length >= 2 ? (
          <section ref={mobileScoresRef} className="scroll-mt-32" data-testid="mobile-vendor-scores">
            <div className="mb-2 border-b border-slate-200 pb-2"><p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">03</p><h3 className="text-base font-bold">{t("compare.mobileScoresTitle")}</h3></div>
            <div className="overflow-hidden border border-[#dfe8ed] bg-white">
              <div className="grid bg-[#0f1418] text-white" style={{ gridTemplateColumns: `repeat(${selectedVendorData.length}, minmax(0, 1fr))` }}>
                {selectedVendorData.map(vendor => (
                  <span key={vendor.id} className="min-w-0 border-r border-white/15 p-2 last:border-0">
                    <strong className="block break-words text-xs">{vendor.name}</strong>
                    <small className="mt-0.5 block break-words text-[9px] leading-3 text-[#bdd3d1]">{vendor.product || t("compare.productNameUnavailable")}</small>
                  </span>
                ))}
              </div>
              {criteria?.map(criterion => (
                <div key={criterion.id} className="border-b border-[#dfe8ed] last:border-0">
                  <h4>
                    <button
                      type="button"
                      className="flex min-h-[54px] w-full scroll-mt-44 items-center justify-between gap-3 bg-[#e6f0f5] px-3 py-2.5 text-left text-xs font-semibold text-[#0f1418]"
                      aria-expanded={expandedMobileCriterion === criterion.id}
                      aria-controls={`mobile-vendor-criterion-panel-${criterion.id}`}
                      onClick={event => toggleMobileCriterion(criterion.id, event.currentTarget)}
                      data-testid={`mobile-vendor-criterion-${criterion.id}`}
                    >
                      {translateCriterionName(tc, criterion.name)}
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expandedMobileCriterion === criterion.id ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                  </h4>
                  {expandedMobileCriterion === criterion.id && (
                  <div id={`mobile-vendor-criterion-panel-${criterion.id}`} className="grid" style={{ gridTemplateColumns: `repeat(${selectedVendorData.length}, minmax(0, 1fr))` }}>
                    {selectedVendorData.map(vendor => {
                      const score = getVendorScore(vendor.id, criterion.id);
                      const notes = getVendorNotes(vendor.id, criterion.id);
                      return (
                        <div key={vendor.id} className="min-w-0 border-r border-[#dfe8ed] p-2.5 last:border-0">
                          <span className="block truncate text-[10px] text-slate-500">{vendor.name}</span>
                          <strong className="mt-1 block font-[Menlo] text-xl text-[#087fca]">{score.toFixed(1)}<span className="text-[10px] font-normal text-slate-400"> / 10</span></strong>
                          <button type="button" className="mt-2 min-h-9 w-full border border-[#b9d8ec] bg-[#dcebf6] text-[10px] font-bold text-[#087fca]" onClick={() => setMobileNote({ vendor, criterion, score, notes })} data-testid={`mobile-vendor-notes-${vendor.id}-${criterion.id}`}>{t("compare.mobileViewNotes")}</button>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="border border-dashed border-[#c9d9e2] bg-[#f7f9f9] p-4 text-center text-xs text-[#66737b]">
            {t("compare.selectAtLeastTwo")}
          </div>
        )}
        <Dialog open={!!mobileNote} onOpenChange={open => { if (!open) setMobileNote(null); }}>
          <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm flex-col gap-0 overflow-hidden rounded-none border-[#dfe8ed] p-0 font-[Montserrat]">
            <DialogHeader className="border-b border-[#dfe8ed] p-4 pr-10 text-left">
              <p className="font-[Menlo] text-[9px] font-bold uppercase tracking-wider text-[#66737b]">{t("compare.notes")}</p>
              <DialogTitle className="mt-1 text-base text-[#0f1418]">{mobileNote && translateCriterionName(tc, mobileNote.criterion.name)}</DialogTitle>
            </DialogHeader>
            {mobileNote && (
              <>
                <div className="grid grid-cols-2 border-b border-[#dfe8ed] bg-[#f7f9f9] text-xs">
                  <div className="border-r border-[#dfe8ed] p-3">
                    <span className="font-[Menlo] text-[9px] font-bold uppercase text-[#66737b]">{t("compare.vendor")}</span>
                    <strong className="mt-1 block break-words">{mobileNote.vendor.name}</strong>
                  </div>
                  <div className="p-3">
                    <span className="font-[Menlo] text-[9px] font-bold uppercase text-[#66737b]">{t("compare.product")}</span>
                    <strong className="mt-1 block break-words">{mobileNote.vendor.product || t("compare.productNameUnavailable")}</strong>
                  </div>
                  <div className="col-span-2 border-t border-[#dfe8ed] p-3">
                    <span className="font-[Menlo] text-[9px] font-bold uppercase text-[#66737b]">{t("compare.score")}</span>
                    <strong className="mt-1 block">{mobileNote.score.toFixed(1)} / 10</strong>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <span className="font-[Menlo] text-[9px] font-bold uppercase text-[#66737b]">{t("compare.notes")}</span>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#3f4d55]">{mobileNote.notes || t("compare.noStoredCommentary")}</p>
                </div>
                <MobileNotesCloseButton onClose={() => setMobileNote(null)} />
              </>
            )}
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <Card className="overflow-hidden">
      <MarketSectionHeader
        title={t("compare.title")}
        description={t("compare.selectAtLeastTwo")}
        icon={Users}
        tone="amber"
      />
      <CardContent className="pt-6">
        <div className={`mb-6 grid gap-2 ${isMobile ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
          {vendors?.map(vendor => {
            const active = selectedVendors.includes(vendor.id);
            return (
              <div key={vendor.id} className={`flex min-h-14 items-start gap-3 rounded-lg border p-3 transition-colors ${active ? "border-[#13a8f0] bg-[#dcebf6] shadow-[inset_3px_0_#13a8f0]" : "border-[#dfe8ed] bg-white"}`}>
                <Checkbox
                  id={vendor.id}
                  checked={active}
                  onCheckedChange={(checked) => handleVendorToggle(vendor.id, !!checked)}
                  className="mt-0.5 data-[state=checked]:border-[#13a8f0] data-[state=checked]:bg-[#13a8f0]"
                  data-testid={`checkbox-vendor-${vendor.id}`}
                />
                <label htmlFor={vendor.id} className="min-w-0 cursor-pointer">
                  <strong className="block break-words text-base font-semibold text-gray-900">{vendor.name}</strong>
                  <small className="mt-1 block break-words text-sm text-gray-600">{vendor.product || t("compare.productNameUnavailable")}</small>
                </label>
              </div>
            );
          })}
        </div>

        {selectedVendorData.length >= 2 ? (
          <div>
            {/* Desktop Table */}
            {!isMobile && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("compare.criteria")}</TableHead>
                      {selectedVendorData.map(vendor => (
                        <TableHead key={vendor.id}>{vendor.name}</TableHead>
                      ))}
                      <TableHead className="text-center">{t("compare.notes")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criteria?.map(criterion => (
                      <Fragment key={criterion.id}>
                      <TableRow>
                        <TableCell className="font-medium">{translateCriterionName(tc, criterion.name)}</TableCell>
                        {selectedVendorData.map(vendor => (
                          <TableCell key={vendor.id} className="text-center">
                            <span className="font-semibold">{getVendorScore(vendor.id, criterion.id)}</span>
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleDesktopNotes(criterion.id)}
                            aria-expanded={expandedDesktopNotes.has(criterion.id)}
                            aria-controls={`desktop-vendor-notes-${criterion.id}`}
                            className="h-8 px-2 text-xs text-[#087fca] hover:text-[#065f9b]"
                            data-testid={`button-notes-${criterion.id}`}
                          >
                            <FileText className="mr-1 h-3 w-3" />
                            {expandedDesktopNotes.has(criterion.id) ? tc("common.close") : t("compare.viewNotes")}
                            <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${expandedDesktopNotes.has(criterion.id) ? "rotate-180" : ""}`} aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedDesktopNotes.has(criterion.id) && (
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                          <TableCell colSpan={selectedVendorData.length + 2} className="p-4">
                            {renderDesktopNotes(criterion)}
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            
            {/* Mobile Card Layout */}
            {isMobile && (
              <div className="space-y-4">
                {criteria?.map(criterion => {
                  return (
                    <div key={criterion.id} className="border border-[#dfe8ed] p-4 bg-white shadow-sm">
                      <div className="mb-4">
                        <div className="font-bold text-base text-[#0f1418] mb-3">
                          {translateCriterionName(tc, criterion.name)}
                        </div>
                        
                        <div className="space-y-3">
                          {selectedVendorData.map(vendor => (
                            <div key={vendor.id} className="flex justify-between items-center gap-3 p-3 bg-[#f7f9f9] border border-[#dfe8ed]">
                              <span className="min-w-0 font-medium text-sm text-[#0f1418]">
                                {vendor.name}
                              </span>
                              <span className="font-bold text-lg text-[#087fca]">
                                {getVendorScore(vendor.id, criterion.id)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                        <div className="border-t border-[#dfe8ed] pt-3">
                          <Button
                            variant="outline"
                            size="sm"
                             onClick={() => toggleDesktopNotes(criterion.id)}
                             aria-expanded={expandedDesktopNotes.has(criterion.id)}
                             aria-controls={`desktop-vendor-notes-${criterion.id}`}
                            className="min-h-10 w-full justify-center border-[#b9d8ec] bg-[#dcebf6] text-[#087fca] hover:bg-[#cde3f2]"
                            data-testid={`button-notes-${criterion.id}`}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                             {expandedDesktopNotes.has(criterion.id) ? tc("common.close") : t("compare.viewNotes")}
                          </Button>
                        </div>
                         {expandedDesktopNotes.has(criterion.id) && (
                           <div className="mt-3 border-t border-slate-200 pt-3">{renderDesktopNotes(criterion)}</div>
                         )}
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="mt-4">
              <Button 
                className={`bg-primary-600 hover:bg-primary-700 ${isMobile ? 'w-full' : ''}`}
                size={isMobile ? "default" : "default"}
                data-testid="button-detailed-report"
              >
                <Download className="mr-2 h-4 w-4" />
                {t("compare.viewDetailedReport")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-[#c9d9e2] bg-[#f7f9f9] py-8 text-center text-sm text-[#66737b]">
            {t("compare.selectAtLeastTwo")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
