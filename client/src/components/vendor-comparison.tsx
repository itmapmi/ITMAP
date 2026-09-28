import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [mobileNote, setMobileNote] = useState<{ vendor: Vendor; criterion: Criteria; score: number; notes: string } | null>(null);
  const isMobile = useIsMobile();

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: scores } = useQuery<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>({
    queryKey: ["/api/markets", marketId, "scores", i18n.language],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/scores?language=${encodeURIComponent(i18n.language)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const { data: criteria } = useQuery<Criteria[]>({
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

  const toggleNotes = (criteriaId: string) => {
    setExpandedNotes(prev => ({
      ...prev,
      [criteriaId]: !prev[criteriaId]
    }));
  };

  const hasNotesForCriteria = (criteriaId: string): boolean => {
    return selectedVendorData.some(vendor => 
      getVendorNotes(vendor.id, criteriaId).trim() !== ""
    );
  };

  const selectedVendorData = vendors?.filter(vendor => selectedVendors.includes(vendor.id)) || [];

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
            <div><p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">03</p><h3 className="text-base font-bold">{t("compare.mobileTitle")}</h3></div>
            <span className="font-[Menlo] text-[10px] uppercase tracking-wider text-slate-500">{t("compare.mobileSelectedCount", { count: selectedVendors.length })}</span>
          </div>
          <div className="grid gap-2">
            {vendors?.map(vendor => {
              const active = selectedVendors.includes(vendor.id);
              return (
                <button key={vendor.id} type="button" onClick={() => handleVendorToggle(vendor.id, !active)} disabled={!active && atMax} className={`flex min-h-14 items-center gap-3 border p-2.5 text-left ${active ? "border-sky-500 bg-blue-50 shadow-[inset_3px_0_#13a8f0]" : "border-slate-200 bg-white"} ${!active && atMax ? "opacity-50" : ""}`} aria-pressed={active} data-testid={`mobile-compare-vendor-${vendor.id}`}>
                  <span className={`grid h-5 w-5 place-items-center border ${active ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{active ? "✓" : ""}</span>
                  <span><strong className="block text-xs">{vendor.name}</strong><small className="mt-0.5 block text-[10px] text-slate-500">{vendor.product || t("compare.productNameUnavailable")}</small></span>
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
        {selectedVendorData.length >= 1 && (
          <div>
            <div className="mb-2 border-b border-slate-200 pb-2"><p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">04</p><h3 className="text-base font-bold">{t("compare.mobileScoresTitle")}</h3></div>
            <div className="overflow-hidden border border-slate-200 bg-slate-50">
              <div className="grid bg-slate-950 text-white" style={{ gridTemplateColumns: `repeat(${selectedVendorData.length}, minmax(0, 1fr))` }}>
                {selectedVendorData.map(vendor => (
                  <span key={vendor.id} className="min-w-0 border-r border-white/15 px-2.5 py-3 last:border-0">
                    <strong className="block break-words text-xs">{vendor.name}</strong>
                    <small className="mt-0.5 block break-words text-[10px] leading-snug text-slate-300">{vendor.product || t("compare.productNameUnavailable")}</small>
                  </span>
                ))}
              </div>
              {criteria?.map(criterion => (
                <div key={criterion.id} className="border-b border-slate-200 last:border-0">
                  <h4 className="bg-blue-50 px-3 py-2.5 text-xs font-semibold">{translateCriterionName(tc, criterion.name)}</h4>
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${selectedVendorData.length}, minmax(0, 1fr))` }}>
                    {selectedVendorData.map(vendor => {
                      const score = getVendorScore(vendor.id, criterion.id);
                      const notes = getVendorNotes(vendor.id, criterion.id);
                      return (
                        <div key={vendor.id} className="min-w-0 border-r border-slate-200 p-2.5 last:border-0">
                          <span className="block truncate text-[10px] text-slate-500">{vendor.name}</span>
                          <strong className="mt-1 block font-[Menlo] text-xl text-sky-600">{score.toFixed(1)}<span className="text-[10px] font-normal text-slate-400"> / 10</span></strong>
                          <button type="button" className="mt-2 min-h-9 w-full border border-blue-200 bg-blue-100 text-[10px] font-bold text-sky-700" onClick={() => setMobileNote({ vendor, criterion, score, notes })}>{t("compare.mobileViewNotes")}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <Dialog open={!!mobileNote} onOpenChange={open => { if (!open) setMobileNote(null); }}>
          <DialogContent className="max-h-[78dvh] max-w-[calc(100%-2rem)] overflow-y-auto font-[Montserrat] sm:max-w-sm">
            <DialogHeader><DialogTitle>{mobileNote && translateCriterionName(tc, mobileNote.criterion.name)}</DialogTitle></DialogHeader>
            {mobileNote && <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="font-[Menlo] text-[9px] uppercase text-slate-500">{t("compare.vendor")}</span><strong className="block">{mobileNote.vendor.name}</strong></div><div><span className="font-[Menlo] text-[9px] uppercase text-slate-500">{t("compare.score")}</span><strong className="block">{mobileNote.score.toFixed(1)} / 10</strong></div></div>
              <div><span className="font-[Menlo] text-[9px] uppercase text-slate-500">{t("compare.product")}</span><strong className="block text-xs">{mobileNote.vendor.product || t("compare.productNameUnavailable")}</strong></div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{mobileNote.notes || t("compare.noStoredCommentary")}</p>
            </div>}
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("compare.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-4 mb-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
          {vendors?.map(vendor => (
            <div key={vendor.id} className={`flex items-center space-x-3 ${isMobile ? 'p-3 bg-gray-50 rounded-lg' : ''}`}>
              <Checkbox
                id={vendor.id}
                checked={selectedVendors.includes(vendor.id)}
                onCheckedChange={(checked) => handleVendorToggle(vendor.id, !!checked)}
                className={isMobile ? 'w-5 h-5' : ''}
                data-testid={`checkbox-vendor-${vendor.id}`}
              />
              <label 
                htmlFor={vendor.id}
                className={`font-medium text-gray-700 cursor-pointer ${isMobile ? 'text-base' : 'text-sm'}`}
              >
                {vendor.name}
              </label>
            </div>
          ))}
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
                    {criteria?.map(criterion => {
                      const isExpanded = expandedNotes[criterion.id];
                      const hasNotes = hasNotesForCriteria(criterion.id);
                      
                      return (
                        <>
                          <TableRow key={criterion.id}>
                            <TableCell className="font-medium">{translateCriterionName(tc, criterion.name)}</TableCell>
                            {selectedVendorData.map(vendor => (
                              <TableCell key={vendor.id} className="text-center">
                                <span className="font-semibold">
                                  {getVendorScore(vendor.id, criterion.id)}
                                </span>
                              </TableCell>
                            ))}
                            <TableCell className="text-center">
                              {hasNotes && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleNotes(criterion.id)}
                                  className="h-6 px-2 text-xs text-blue-600 hover:text-blue-800"
                                >
                                  <FileText className="mr-1 h-3 w-3" />
                                  {t("compare.viewNotes")}
                                  {isExpanded ? (
                                    <ChevronDown className="ml-1 h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="ml-1 h-3 w-3" />
                                  )}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          
                          {hasNotes && isExpanded && (
                            <TableRow>
                              <TableCell colSpan={selectedVendorData.length + 2} className="p-4 bg-gray-50 dark:bg-gray-800">
                                <div className="space-y-3">
                                  {selectedVendorData.map(vendor => {
                                    const notes = getVendorNotes(vendor.id, criterion.id);
                                    if (!notes.trim()) return null;
                                    
                                    return (
                                      <div key={vendor.id} className="border-l-3 border-blue-500 pl-3">
                                        <div className="font-medium text-sm text-blue-700 dark:text-blue-300 mb-1">
                                          {vendor.name}
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                                          {notes}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            
            {/* Mobile Card Layout */}
            {isMobile && (
              <div className="space-y-4">
                {criteria?.map(criterion => {
                  const isExpanded = expandedNotes[criterion.id];
                  const hasNotes = hasNotesForCriteria(criterion.id);
                  
                  return (
                    <div key={criterion.id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                      <div className="mb-4">
                        <div className="font-medium text-base text-gray-900 mb-3">
                          {translateCriterionName(tc, criterion.name)}
                        </div>
                        
                        <div className="space-y-3">
                          {selectedVendorData.map(vendor => (
                            <div key={vendor.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                              <span className="font-medium text-sm text-gray-800">
                                {vendor.name}
                              </span>
                              <span className="font-bold text-lg text-blue-600">
                                {getVendorScore(vendor.id, criterion.id)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {hasNotes && (
                        <div className="border-t border-gray-200 pt-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleNotes(criterion.id)}
                            className="w-full justify-center text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            data-testid={`button-notes-${criterion.id}`}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            {isExpanded ? t("compare.hideNotes") : t("compare.viewNotes")}
                            {isExpanded ? (
                              <ChevronDown className="ml-2 h-4 w-4" />
                            ) : (
                              <ChevronRight className="ml-2 h-4 w-4" />
                            )}
                          </Button>
                          
                          {isExpanded && (
                            <div className="mt-3 pt-3 bg-gray-50 rounded-lg p-3">
                              <div className="space-y-3">
                                {selectedVendorData.map(vendor => {
                                  const notes = getVendorNotes(vendor.id, criterion.id);
                                  if (!notes.trim()) return null;
                                  
                                  return (
                                    <div key={vendor.id} className="border-l-4 border-blue-500 pl-3">
                                      <div className="font-medium text-sm text-blue-700 mb-1">
                                        {vendor.name}
                                      </div>
                                      <div className="text-sm text-gray-600 whitespace-pre-wrap">
                                        {notes}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
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
          <div className="text-center py-8 text-gray-500">
            {t("compare.selectAtLeastTwo")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
