import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest } from "@/lib/queryClient";
import { track } from "@/lib/track";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Vendor, VendorScore, Criteria } from "@shared/schema";
import VendorComparison from "./vendor-comparison";
import { useIsMobile } from "@/hooks/use-mobile";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { VendorSelectionModal } from "./vendor-selection-modal";
import {
  DEFAULT_QUADRANT_THRESHOLDS,
  computeAxisComposites,
  isPlausibleStoredComposite,
  positionFromComposites,
  type PublishedChartConfig,
  type QuadrantBox,
} from "@shared/quadrant-positioning";
import { buildChartProvenanceLines } from "@shared/quadrant-export";
import { useAuth } from "@/hooks/useAuth";
import {
  allHistoricalPositionsQueryKey,
  historicalPositionsQueryKey,
} from "@/lib/magic-quadrant-query-keys";

interface MagicQuadrantProps {
  marketId: string;
  marketName: string;
  marketType?: "mature" | "emerging";
  enableDrag?: boolean;
  onLabelPositionChange?: (vendorId: string, x: number, y: number) => void;
  /** True only on the /mobile/* route — hides the Timeline and Criteria
   * Weights controls, which are too fiddly for a phone. Independent of the
   * isMobile viewport hook so narrowing a desktop browser doesn't hide them. */
  mobileMode?: boolean;
}

interface VendorWithScores extends Vendor {
  scores: { [criteriaId: string]: number };
  /** Canvas X (0–100) — the plotted position, from the vendor's own composite. */
  executionScore: number;
  /** Canvas Y (0–100). */
  viabilityScore: number;
  /** Weighted composites in rubric units (0–10). */
  executionComposite: number;
  viabilityComposite: number;
  box: QuadrantBox;
  /** True when this dot comes from a stored history snapshot (slider). */
  isHistorical: boolean;
}

interface VendorModalData {
  vendor: VendorWithScores;
  position: { x: number; y: number };
}

interface NewsArticle {
  id: string;
  title: string;
  url: string | null;
  publishedAt: string | Date;
  impactLabel: string | null;
  keyTakeaway: string | null;
  summary: string | null;
}

interface HistoricalPoint {
  id: string;
  vendorId: string;
  executionScore: string | number;
  viabilityScore: string | number;
  recordedAt: string | Date;
}


/**
 * Dot positions switched from roster-relative (min/max stretched) to
 * absolute composites on this date. Label positions dragged against the old
 * layout are absolute pixels with no relation to where the dots are now, so
 * anything saved before the cutover is ignored (auto-placed) until an admin
 * re-drags it; positions saved afterwards are honoured as usual.
 */
const LABEL_POSITIONS_VALID_FROM = Date.parse("2026-09-20T00:00:00Z");

const HISTORICAL_WEEKS = 26; // Six months, shown in two-week intervals
const HISTORICAL_TICK_INTERVAL = 2;
const historicalTimelineTicks = Array.from(
  { length: HISTORICAL_WEEKS / HISTORICAL_TICK_INTERVAL + 1 },
  (_, index) => index * HISTORICAL_TICK_INTERVAL,
);

export default function MagicQuadrant({ marketId, marketName, marketType = "mature", enableDrag = false, onLabelPositionChange, mobileMode = false }: MagicQuadrantProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timelineValue, setTimelineValue] = useState([HISTORICAL_WEEKS]); // Start at the current week
  const [selectedVendor, setSelectedVendor] = useState<VendorModalData | null>(null);
  const [evidenceVendor, setEvidenceVendor] = useState<{ vendor: VendorWithScores; pixelX: number; pixelY: number } | null>(null);
  const [criteriaWeights, setCriteriaWeights] = useState<{ [id: string]: number }>({});
  const [notes, setNotes] = useState<{ [key: string]: string }>({});
  // The criteria-notes editor writes shared analyst commentary through the
  // admin-only score endpoint, so only admins get the tab at all.
  const { isAdmin } = useAuth();
  const [labelPositions, setLabelPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [mobileChartScale, setMobileChartScale] = useState(0.36);
  const [mobileChartPan, setMobileChartPan] = useState({ x: 0, y: 8 });
  const [mobileSelectedVendors, setMobileSelectedVendors] = useState<string[]>([]);
  const mobileChartViewportRef = useRef<HTMLDivElement>(null);
  const mobilePointers = useRef(new Map<number, { x: number; y: number }>());
  const mobileDragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mobilePinchOrigin = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
  const mobileDragMoved = useRef(false);
  const [mobileCriteriaOpen, setMobileCriteriaOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const clampMobilePan = (x: number, y: number, scale = mobileChartScale) => {
    const viewport = mobileChartViewportRef.current;
    if (!viewport) return { x, y };
    return {
      x: Math.min(18, Math.max(viewport.clientWidth - 760 * scale - 18, x)),
      y: Math.min(10, Math.max(viewport.clientHeight - 547 * scale - 10, y)),
    };
  };

  const setMobileScaleAround = (next: number, anchorX?: number, anchorY?: number) => {
    const scale = Math.min(1.35, Math.max(0.25, next));
    const factor = scale / mobileChartScale;
    const ax = anchorX ?? (mobileChartViewportRef.current?.clientWidth ?? 390) / 2;
    const ay = anchorY ?? 145;
    setMobileChartPan(pan => clampMobilePan(ax - (ax - pan.x) * factor, ay - (ay - pan.y) * factor, scale));
    setMobileChartScale(scale);
  };

  const fitMobileChart = () => {
    const viewport = mobileChartViewportRef.current;
    if (!viewport) {
      setMobileChartScale(0.36);
      setMobileChartPan({ x: 0, y: 8 });
      return;
    }
    const horizontalRoom = Math.max(1, viewport.clientWidth - 2);
    const verticalRoom = Math.max(1, viewport.clientHeight - 16);
    const scale = Math.min(1.35, Math.max(0.25, Math.min(horizontalRoom / 760, verticalRoom / 547)));
    setMobileChartScale(scale);
    setMobileChartPan({
      x: Math.max(0, (viewport.clientWidth - 760 * scale) / 2),
      y: 8,
    });
  };

  const resetMobileChart = () => {
    fitMobileChart();
  };

  const onMobileChartPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    mobilePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    mobileDragMoved.current = false;
    if (mobilePointers.current.size === 1) {
      mobileDragOrigin.current = { x: event.clientX, y: event.clientY, panX: mobileChartPan.x, panY: mobileChartPan.y };
    } else if (mobilePointers.current.size === 2) {
      const points = Array.from(mobilePointers.current.values());
      const first = points[0]!;
      const second = points[1]!;
      mobilePinchOrigin.current = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        scale: mobileChartScale,
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
    }
  };

  const onMobileChartPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mobilePointers.current.has(event.pointerId)) return;
    mobilePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mobilePointers.current.size === 2) {
      const points = Array.from(mobilePointers.current.values());
      const first = points[0]!;
      const second = points[1]!;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (mobilePinchOrigin.current.distance) {
        setMobileScaleAround(
          mobilePinchOrigin.current.scale * distance / mobilePinchOrigin.current.distance,
          mobilePinchOrigin.current.x,
          mobilePinchOrigin.current.y,
        );
      }
      mobileDragMoved.current = true;
      return;
    }
    const dx = event.clientX - mobileDragOrigin.current.x;
    const dy = event.clientY - mobileDragOrigin.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) mobileDragMoved.current = true;
    setMobileChartPan(clampMobilePan(mobileDragOrigin.current.panX + dx, mobileDragOrigin.current.panY + dy));
  };

  const onMobileChartPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    mobilePointers.current.delete(event.pointerId);
  };

  const onMobileChartWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMobileScaleAround(mobileChartScale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX - rect.left, event.clientY - rect.top);
  };

  // Calculate date range for the last six months (26 weeks)
  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 6);
  
  // Generate weekly dates from start to current
  const getDateForWeek = (weekIndex: number): Date => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + (weekIndex * 7));
    return date;
  };
  
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  const currentWeekIndex = timelineValue[0];
  const selectedDate = getDateForWeek(currentWeekIndex);
  const weeksAgo = Math.floor((today.getTime() - selectedDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: scores, isLoading: scoresLoading } = useQuery<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>({
    queryKey: ["/api/markets", marketId, "scores"],
    refetchOnWindowFocus: true,
    staleTime: 0, // Always refetch to ensure fresh data
  });

  // Published chart configuration: effective saved weights, the market's box
  // thresholds and (for exports only) the current weight version.
  const { data: chartConfig, isLoading: weightsLoading } = useQuery<PublishedChartConfig>({
    queryKey: ["/api/markets", marketId, "chart-config"],
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  useEffect(() => {
    if (!mobileMode || vendorsLoading || scoresLoading || weightsLoading) return;
    const viewport = mobileChartViewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(fitMobileChart);
    const observer = new ResizeObserver(fitMobileChart);
    observer.observe(viewport);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mobileMode, marketId, vendorsLoading, scoresLoading, weightsLoading]);

  // Query historical positions for the selected date
  const { data: historicalPositions } = useQuery<any[]>({
    // The week index is stable across renders and changes whenever the slider
    // selects a different week. Do not use selectedDate here because it is
    // recreated from the current time on every render.
    queryKey: historicalPositionsQueryKey(marketId, currentWeekIndex),
    queryFn: async () => {
      const response = await fetch(`/api/markets/${marketId}/historical-positions?date=${selectedDate.toISOString()}`);
      if (!response.ok) throw new Error('Failed to fetch historical positions');
      return response.json();
    },
    enabled: !!marketId && weeksAgo > 0, // Only fetch historical data when not on current week
  });

  // Query saved label positions
  const { data: savedLabelPositions } = useQuery<any[]>({
    queryKey: ["/api/markets", marketId, "label-positions"],
  });

  // Evidence popover: last 3 news events for the clicked vendor (news source only).
  const { data: evidenceNews } = useQuery<NewsArticle[]>({
    queryKey: ["/api/markets", marketId, "vendors", evidenceVendor?.vendor.id, "news"],
    queryFn: async () => {
      if (!evidenceVendor) return [];
      const res = await fetch(`/api/markets/${marketId}/vendors/${evidenceVendor.vendor.id}/news?limit=3`);
      if (!res.ok) throw new Error("Failed to fetch vendor news");
      return res.json();
    },
    enabled: !!evidenceVendor?.vendor.id,
    staleTime: 2 * 60_000,
  });

  // Trajectory data: last 3 historical positions for each vendor.
  const { data: allHistoricalPositions } = useQuery<HistoricalPoint[]>({
    queryKey: allHistoricalPositionsQueryKey(marketId),
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}/historical-positions`);
      if (!res.ok) throw new Error("Failed to fetch historical positions");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // Mutation for saving notes
  const saveNotesMutation = useMutation({
    mutationFn: async (data: { vendorId: string; criteriaId: string; notes: string }) => {
      return apiRequest(`/api/vendor-scores`, 'POST', {
        vendorId: data.vendorId,
        criteriaId: data.criteriaId,
        score: scores?.find(s => s.vendorId === data.vendorId && s.criteriaId === data.criteriaId)?.score || 0,
        notes: data.notes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "scores"] });
      toast({
        title: "Notes Saved",
        description: "Your notes have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save notes. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Handler for generating vendor evaluation report
  const handleGenerateReport = async (selectedVendorIds: string[]) => {
    setIsGenerating(true);
    try {
      const response = await apiRequest(
        `/api/markets/${marketId}/generate-vendor-evaluation-pdf-report`,
        "POST",
        { vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined }
      );

      if (!response.ok) {
        throw new Error("Failed to generate report");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanMarketName = marketName.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      a.download = `ITMAP for ${cleanMarketName} - Vendor Evaluation.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Vendor Evaluation report generated successfully",
      });

      setShowVendorModal(false);
    } catch (error) {
      console.error("Error generating report:", error);
      toast({
        title: "Error",
        description: "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Initialize notes when scores load
  useEffect(() => {
    if (scores) {
      const notesMap: { [key: string]: string } = {};
      scores.forEach(score => {
        if (score.notes) {
          notesMap[`${score.vendorId}-${score.criteriaId}`] = score.notes;
        }
      });
      setNotes(notesMap);
    }
  }, [scores]);

  // Slider state starts at the market's published (saved) weights. Moving a
  // slider is the buyer's what-if view; "Reset to published" restores these.
  useEffect(() => {
    if (chartConfig) setCriteriaWeights({ ...chartConfig.weightsById });
  }, [chartConfig]);

  // Load saved label positions, skipping any dragged before the absolute-
  // positioning cutover (see LABEL_POSITIONS_VALID_FROM).
  useEffect(() => {
    if (savedLabelPositions) {
      const positions: { [vendorId: string]: { x: number; y: number } } = {};
      savedLabelPositions.forEach((pos: any) => {
        const savedAt = Date.parse(pos.updatedAt ?? pos.createdAt ?? "");
        if (!Number.isFinite(savedAt) || savedAt < LABEL_POSITIONS_VALID_FROM) return;
        positions[pos.vendorId] = { 
          x: parseFloat(pos.labelX), 
          y: parseFloat(pos.labelY) 
        };
      });
      setLabelPositions(positions);
    }
  }, [savedLabelPositions]);

  // Handle window resize and orientation changes
  useEffect(() => {
    const updateContainerWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    // Initial measurement
    updateContainerWidth();

    // Listen for resize and orientation change events
    window.addEventListener('resize', updateContainerWidth);
    window.addEventListener('orientationchange', updateContainerWidth);

    // Cleanup
    return () => {
      window.removeEventListener('resize', updateContainerWidth);
      window.removeEventListener('orientationchange', updateContainerWidth);
    };
  }, [vendorsLoading, scoresLoading, weightsLoading, mobileMode]);

  // Seed the mobile comparison with the first two vendors exactly once per
  // market. Deliberately NOT keyed on the selection length: if it re-ran
  // whenever the list emptied, the user could never uncheck the last vendor
  // (it would snap straight back to the default pair).
  const mobileDefaultSeededFor = useRef<string | null>(null);
  // Declared BEFORE the seeding effect so that on a market change the reset
  // runs first and the seed can then repopulate (effects run in order).
  useEffect(() => {
    setMobileSelectedVendors([]);
    mobileDefaultSeededFor.current = null;
    resetMobileChart();
  }, [marketId]);

  useEffect(() => {
    if (!mobileMode || !vendors || vendors.length < 2) return;
    if (mobileDefaultSeededFor.current === marketId) return;
    mobileDefaultSeededFor.current = marketId;
    setMobileSelectedVendors(vendors.slice(0, 2).map(vendor => vendor.id));
  }, [mobileMode, vendors, marketId]);

  // ── Positioning ────────────────────────────────────────────────────────────
  // Every dot depends only on the vendor's own scores, the weights in play and
  // the market's thresholds (shared/quadrant-positioning.ts). No roster-relative
  // normalisation: adding or removing another vendor never moves a dot, and a
  // market may legitimately have an empty Leaders box.
  const thresholds = chartConfig?.thresholds ?? DEFAULT_QUADRANT_THRESHOLDS;
  const publishedWeights = chartConfig?.weightsById ?? {};
  const positioningCriteria = criteria ?? [];
  // True while any slider differs from the market's saved weights.
  const isWhatIf = positioningCriteria.some(
    c => (criteriaWeights[c.id] ?? publishedWeights[c.id]) !== publishedWeights[c.id],
  );

  const vendorsWithScores: VendorWithScores[] = (vendors || []).map(vendor => {
    const vendorScores: { [criteriaId: string]: number } = {};
    if (scores) {
      for (const score of scores) {
        if (score.vendorId !== vendor.id) continue;
        const value = parseFloat(score.score);
        if (Number.isFinite(value)) vendorScores[score.criteriaId] = value;
      }
    }

    // History slider: stored rows are the composites the snapshot cron
    // computed with the weights published at the time, so they go through the
    // same plot transform as live dots (sliders cannot re-weight history).
    if (weeksAgo > 0 && historicalPositions) {
      const historical = historicalPositions.find(pos => pos.vendorId === vendor.id);
      if (
        historical &&
        isPlausibleStoredComposite(historical.executionScore) &&
        isPlausibleStoredComposite(historical.viabilityScore)
      ) {
        const position = positionFromComposites(
          { execution: Number(historical.executionScore), viability: Number(historical.viabilityScore) },
          thresholds,
        );
        return {
          ...vendor,
          scores: vendorScores,
          executionScore: position.x,
          viabilityScore: position.y,
          executionComposite: position.execution,
          viabilityComposite: position.viability,
          box: position.box,
          isHistorical: true,
        };
      }
    }

    // Product Capabilities and ISV Ecosystem arrive already derived: the
    // server persists them (with their coverage roll-up) from the feature
    // support matrix via shared/derived-feature-scores.ts, so the chart uses
    // the stored value like every other criterion instead of recomputing.
    const position = positionFromComposites(
      computeAxisComposites(positioningCriteria, criteriaWeights, vendorScores),
      thresholds,
    );
    return {
      ...vendor,
      scores: vendorScores,
      executionScore: position.x,
      viabilityScore: position.y,
      executionComposite: position.execution,
      viabilityComposite: position.viability,
      box: position.box,
      isHistorical: false,
    };
  });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || vendorsLoading || scoresLoading || weightsLoading) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Responsive dimensions based on container and device
    const containerWidth = containerRef.current.offsetWidth;
    // The dedicated mobile route deliberately keeps the desktop 760px drawing
    // coordinate system. The viewport below scales/scrolls that fixed canvas,
    // so persisted label positions and vendor coordinates never move merely
    // because the phone width or orientation changed.
    const compactChart = isMobile && !mobileMode;
    const width = mobileMode ? 760 : (isMobile ? Math.min(containerWidth - 20, 420) : Math.min(containerWidth, 760));
    // Rectangle on desktop: 3-column × 2-row grid suits a wider aspect ratio.
    const height = mobileMode ? 547 : (isMobile ? 360 : Math.round(width * 0.72));
    // Extra top/bottom margin accommodates outside box labels above/below the chart.
    const margin = isMobile && !mobileMode
      ? { top: 36, right: 15, bottom: 68, left: 50 }
      : { top: 44, right: 20, bottom: 82, left: 60 };

    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    // ── Six-box ITMAP chart layout (3 cols × 2 rows) ─────────────────────────
    const defs = svg.append("defs");
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Leaders gradient (top-right box only)
    const leadersGradient = defs.append("linearGradient")
      .attr("id", "leadersGradient")
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%");
    leadersGradient.append("stop").attr("offset", "0%").attr("stop-color", "#F7F4FF").attr("stop-opacity", 1);
    leadersGradient.append("stop").attr("offset", "100%").attr("stop-color", "#EBE4FD").attr("stop-opacity", 1);

    const dotGradient = defs.append("radialGradient")
      .attr("id", "dotGradient")
      .attr("cx", "30%").attr("cy", "30%").attr("r", "70%");
    dotGradient.append("stop").attr("offset", "0%").attr("stop-color", "#9A94F2");
    dotGradient.append("stop").attr("offset", "50%").attr("stop-color", "#4F46E5");
    dotGradient.append("stop").attr("offset", "100%").attr("stop-color", "#3730A3");

    // Pixel boundaries
    const leftX   = margin.left;
    const rightX  = width - margin.right;
    const topY    = margin.top;
    const bottomY = height - margin.bottom;
    const col1X   = xScale(33);   // left | middle column divider
    const col2X   = xScale(67);   // middle | right column divider
    const midY    = yScale(50);   // top | bottom row divider

    // Six box fills — only Leaders (top-right) is coloured
    const boxes = [
      { x: leftX, y: topY,  w: col1X - leftX,  h: midY - topY,    fill: "#FDFEFF"                },
      { x: col1X, y: topY,  w: col2X - col1X,  h: midY - topY,    fill: "#FDFEFF"                },
      { x: col2X, y: topY,  w: rightX - col2X, h: midY - topY,    fill: "url(#leadersGradient)"  },
      { x: leftX, y: midY,  w: col1X - leftX,  h: bottomY - midY, fill: "#FDFEFF"                },
      { x: col1X, y: midY,  w: col2X - col1X,  h: bottomY - midY, fill: "#FDFEFF"                },
      { x: col2X, y: midY,  w: rightX - col2X, h: bottomY - midY, fill: "#FDFEFF"                },
    ];
    boxes.forEach(b => {
      svg.append("rect")
        .attr("x", b.x).attr("y", b.y)
        .attr("width", b.w).attr("height", b.h)
        .attr("fill", b.fill);
    });

    // Outer border
    svg.append("rect")
      .attr("x", leftX).attr("y", topY)
      .attr("width", chartWidth).attr("height", chartHeight)
      .attr("fill", "none")
      .attr("stroke", "#E2E8F0").attr("stroke-width", 1.5);

    // Internal column dividers
    [col1X, col2X].forEach(x => {
      svg.append("line")
        .attr("x1", x).attr("x2", x).attr("y1", topY).attr("y2", bottomY)
        .attr("stroke", "#E2E8F0").attr("stroke-width", 1.5);
    });
    // Internal row divider
    svg.append("line")
      .attr("x1", leftX).attr("x2", rightX).attr("y1", midY).attr("y2", midY)
      .attr("stroke", "#E2E8F0").attr("stroke-width", 1.5);

    // Add professional-looking axes
    const xAxis = d3.axisBottom(xScale)
      .tickSize(0)
      .tickSizeOuter(0)
      .tickFormat(d => d === 0 || d === 100 ? `${d}` : '');
    const yAxis = d3.axisLeft(yScale)
      .tickSize(0)
      .tickSizeOuter(0)
      .tickFormat(d => d === 50 || d === 100 ? `${d}` : '');

    const xAxisG = svg.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(xAxis);
    xAxisG.selectAll(".tick line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);
    xAxisG.select(".domain").remove();

    const yAxisG = svg.append("g")
      .attr("class", "y-axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis);
    yAxisG.selectAll(".tick line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);
    yAxisG.select(".domain").remove();

    // Style axis text
    svg.selectAll(".x-axis text, .y-axis text")
      .attr("fill", "#64748b")
      .attr("font-size", compactChart ? "10px" : "12px")
      .attr("font-weight", "600");

    // Add professional axis labels — positioned close to the chart box
    const axisLabelSize = compactChart ? "11px" : "14px";
    // X-axis label: sits just below the tick numbers (margin.bottom - 8px clearance)
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - margin.bottom + (compactChart ? 38 : 48))
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(compactChart ? "Execution →" : "Product Strategy and Execution →");

    // Y-axis label: positioned left of the tick numbers to avoid overlapping "50"
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", compactChart ? 12 : 18)
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(compactChart ? "Viability →" : "Vendor Viability →");

    // ITMAP watermark — bottom right, outside the grid
    svg.append("text")
      .attr("x", width - margin.right)
      .attr("y", height - (compactChart ? 4 : 6))
      .attr("text-anchor", "end")
      .attr("font-size", compactChart ? "9px" : "11px")
      .attr("font-weight", "500")
      .attr("fill", "#94a3b8")
      .text("Powered by itmap.ai");

    // ── Six-box labels — outside the chart boundary ───────────────────────
    const bandLabelSize = compactChart ? "10px" : "12px";
    const bandFontPx   = compactChart ? 10 : 12;
    const badgeCharW   = compactChart ? 6.0 : 6.7;  // estimated px per char at each font size
    const badgePadH    = 8;  // horizontal padding each side
    const badgePadV    = 4;  // vertical padding above & below text
    const col0Mid = (leftX + col1X) / 2;
    const col1Mid = (col1X + col2X) / 2;
    const col2Mid = (col2X + rightX) / 2;

    // Helper: draw a filled rounded-rect badge then the label text on top.
    // cx/y follow the same convention as the plain text calls (x=centre, y=baseline).
    const drawBadge = (cx: number, y: number, text: string, bgColor: string, fw: string) => {
      const h = bandFontPx + badgePadV * 2;
      // Append rect with placeholder position/width; updated after measuring text.
      const rect = svg.append("rect")
        .attr("x", cx)
        .attr("y", y - bandFontPx - badgePadV)
        .attr("width", 0)
        .attr("height", h)
        .attr("rx", 4)
        .attr("fill", bgColor);
      const textNode = svg.append("text")
        .attr("x", cx).attr("y", y)
        .attr("text-anchor", "middle")
        .attr("font-size", bandLabelSize)
        .attr("font-weight", fw)
        .attr("fill", "#ffffff")
        .text(text);
      // Use SVG's native measurement for exact pixel width — eliminates clipping on long labels.
      const textEl = textNode.node();
      const measuredW = textEl ? textEl.getComputedTextLength() : text.length * badgeCharW;
      const w = Math.ceil(measuredW) + badgePadH * 2;
      rect
        .attr("x", cx - w / 2)
        .attr("width", w);
    };

    // Top labels — sit above the chart, centred on each column
    const topLabelY = topY - (compactChart ? 8 : 10);

    // Tick marks connecting top badges to the chart top edge (drawn first, behind badges)
    [col0Mid, col1Mid, col2Mid].forEach(cx => {
      svg.append("line")
        .attr("x1", cx).attr("x2", cx)
        .attr("y1", topY - (compactChart ? 5 : 6)).attr("y2", topY)
        .attr("stroke", "#CBD5E1").attr("stroke-width", 1);
    });

    drawBadge(col0Mid, topLabelY, "Custodians",  "#1E3A5F", "600");
    drawBadge(col1Mid, topLabelY, "Contenders",  "#1E3A5F", "600");
    drawBadge(col2Mid, topLabelY, "Leaders",     "#6D5BD0", "700");

    // Bottom labels — sit below the chart, centred on each column
    const botLabelY = bottomY + (compactChart ? 18 : 20);

    // Tick marks connecting bottom badges to the chart bottom edge (drawn first, behind badges)
    [col0Mid, col1Mid, col2Mid].forEach(cx => {
      svg.append("line")
        .attr("x1", cx).attr("x2", cx)
        .attr("y1", bottomY).attr("y2", bottomY + (compactChart ? 5 : 6))
        .attr("stroke", "#CBD5E1").attr("stroke-width", 1);
    });

    drawBadge(col0Mid, botLabelY, compactChart ? "Emerging" : "Emerging Players", "#1E3A5F", "600");
    drawBadge(col1Mid, botLabelY, "Specialists", "#1E3A5F", "600");
    drawBadge(col2Mid, botLabelY, "Catalysts",   "#1E3A5F", "600");

    // Dots are plotted at their EXACT computed (Execution, Viability) coordinates.
    // No layout fudging — labels move to avoid overlap, dots never do.
    const adjustedVendors = vendorsWithScores.map(vendor => ({
      ...vendor,
      adjustedX: vendor.executionScore,
      adjustedY: vendor.viabilityScore,
    }));

    // Add enhanced vendor dots with collision detection
    const vendorGroups = svg.selectAll(".vendor-group")
      .data(adjustedVendors)
      .enter()
      .append("g")
      .attr("class", "vendor-group")
      .attr("data-vendor-id", d => d.id);

    vendorGroups.filter(d => mobileMode && mobileSelectedVendors.includes(d.id))
      .append("circle")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", 13)
      .attr("fill", "none")
      .attr("stroke", "#4F46E5")
      .attr("stroke-width", 2)
      .attr("opacity", .35);

    // Vendor dots — radial gradient fill, white ring, indigo shadow
    vendorGroups.append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", d => mobileMode && mobileSelectedVendors.includes(d.id) ? 7 : 6)
      .attr("fill", "url(#dotGradient)")
      .attr("stroke", "#FFFFFF")
      .attr("stroke-width", d => mobileMode && mobileSelectedVendors.includes(d.id) ? 3 : 2)
      .style("cursor", "pointer")
      .style("filter", "drop-shadow(0 2px 5px rgba(79,70,229,0.35))")
      .on("mouseover", function(event, d) {
        d3.select(this)
          .attr("r", 9)
          .attr("stroke-width", 2.5)
          .style("filter", "drop-shadow(0 3px 8px rgba(79,70,229,0.45))");
        const parentGroup = d3.select(this.parentNode as Element);
        const hoverFontSize = compactChart ? 10 : 12;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "700")
          .attr("font-size", `${hoverFontSize}px`);
      })
      .on("mouseout", function(event, d) {
        d3.select(this)
          .attr("r", mobileMode && mobileSelectedVendors.includes(d.id) ? 7 : 6)
          .attr("stroke-width", mobileMode && mobileSelectedVendors.includes(d.id) ? 3 : 2)
          .style("filter", "drop-shadow(0 2px 5px rgba(79,70,229,0.35))");
        const parentGroup = d3.select(this.parentNode as Element);
        const normalFontSize = compactChart ? 9 : 11;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "600")
          .attr("font-size", `${normalFontSize}px`);
      })
.on("click", function(event, d) {
        if (mobileMode) {
          if (mobileDragMoved.current) return;
          // Free check/uncheck — no minimum. Only the max-3 cap applies.
          setMobileSelectedVendors(previous => previous.includes(d.id)
            ? previous.filter(id => id !== d.id)
            : (previous.length < 3 ? [...previous, d.id] : previous));
          return;
        }
        setEvidenceVendor({
          vendor: d,
          pixelX: xScale(d.adjustedX),
          pixelY: yScale(d.adjustedY)
        });
        track("chart_interacted", { marketId, vendorId: (d as any).id ?? null, metadata: { vendorName: (d as any).name } });
        track("vendor_viewed", { marketId, vendorId: (d as any).id ?? null, metadata: { vendorName: (d as any).name } });
      });

    // Free-form label placement: no collision avoidance, no connector line.
    // A label sits at a fixed default offset from its dot until the user
    // drags it; a dragged position is honoured exactly, anywhere on the
    // canvas, for as long as it's saved — the user is in full control of
    // where every label sits.
    const minLabelX = margin.left + 2;
    const maxLabelX = width - margin.right - 2;
    const minLabelY = margin.top + 10;
    const maxLabelY = height - margin.bottom - 2;
    const clampToCanvas = (x: number, y: number) => ({
      x: Math.max(minLabelX, Math.min(x, maxLabelX)),
      y: Math.max(minLabelY, Math.min(y, maxLabelY)),
    });
    const DEFAULT_LABEL_OFFSET_X = 8;
    const DEFAULT_LABEL_OFFSET_Y = 4;

    adjustedVendors.forEach((vendor, index) => {
      const dotX = xScale(vendor.adjustedX);
      const dotY = yScale(vendor.adjustedY);
      const customPos = labelPositions[vendor.id];
      const { x: labelX, y: labelY } = clampToCanvas(
        customPos ? customPos.x : dotX + DEFAULT_LABEL_OFFSET_X,
        customPos ? customPos.y : dotY + DEFAULT_LABEL_OFFSET_Y,
      );

      const labelGroup = vendorGroups.filter((d, i) => i === index);

      // Every vendor label is always drawn (mobile included — the plane is a
      // fixed 760×547 canvas, so there is room). Vendors picked for the mobile
      // comparison are only *highlighted*, never the sole ones labelled.
      const isMobileHighlighted = mobileMode && mobileSelectedVendors.includes(vendor.id);
      const fontSize = compactChart ? 9 : 11;
      const labelText = labelGroup.append("text")
        .attr("class", "vendor-label")
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("text-anchor", "start")
        .attr("fill", isMobileHighlighted ? "#4338CA" : "#334155")
        .attr("font-size", `${isMobileHighlighted ? fontSize + 1 : fontSize}px`)
        .attr("font-weight", isMobileHighlighted ? "800" : "600")
        .style("cursor", enableDrag ? "move" : "default")
        .text(vendor.name);
      if (isMobileHighlighted) labelGroup.raise();

      // Add drag behavior to the label (only if enableDrag is true)
      if (enableDrag) {
        const drag = d3.drag()
          .on("start", function(event) {
            d3.select(this.parentNode as Element).raise();
          })
          .on("drag", function(event) {
            labelText.attr("x", event.x).attr("y", event.y);
          })
          .on("end", function(event) {
            // Save the new position locally
            setLabelPositions(prev => ({
              ...prev,
              [vendor.id]: { x: event.x, y: event.y }
            }));

            // Notify parent component if callback provided
            if (onLabelPositionChange) {
              onLabelPositionChange(vendor.id, event.x, event.y);
            }
          });

        // Apply drag to text
        labelText.call(drag as any);
      }
    });

  }, [vendorsWithScores, criteriaWeights, isMobile, mobileMode, mobileSelectedVendors, labelPositions, enableDrag, onLabelPositionChange, marketId, containerWidth, allHistoricalPositions]);

  const handleWeightChange = (criteriaId: string, newWeight: number) => {
    setCriteriaWeights(prev => ({
      ...prev,
      [criteriaId]: newWeight
    }));
  };

  const resetWeightsToPublished = () => {
    if (chartConfig) setCriteriaWeights({ ...chartConfig.weightsById });
  };

  if (vendorsLoading || scoresLoading || weightsLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3">
          <Skeleton className="h-[400px] w-full" />
        </div>
        <div className="lg:col-span-1">
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  // Export the quadrant graphic as a PDF (market name on top, chart below).
  // Fully client-side: serialize the SVG → rasterize to PNG at 2x → embed via pdf-lib.
  const handleExportPdf = async () => {
    const svgEl = svgRef.current;
    if (!svgEl || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const svgWidth = Number(svgEl.getAttribute("width")) || svgEl.clientWidth;
      const svgHeight = Number(svgEl.getAttribute("height")) || svgEl.clientHeight;
      if (!svgWidth || !svgHeight || !isFinite(svgWidth) || !isFinite(svgHeight)) {
        throw new Error("Chart has no size yet");
      }

      // Serialize the SVG with an explicit xmlns so it loads as an image
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svgString = new XMLSerializer().serializeToString(clone);
      const svgUrl = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));

      const pngDataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = 2; // 2x for crisp print quality
            const canvas = document.createElement("canvas");
            canvas.width = svgWidth * scale;
            canvas.height = svgHeight * scale;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas not supported");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/png"));
          } catch (e) {
            reject(e);
          } finally {
            URL.revokeObjectURL(svgUrl);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          reject(new Error("Failed to render chart image"));
        };
        img.src = svgUrl;
      });

      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const png = await pdfDoc.embedPng(pngDataUrl);

      // Provenance block: everything needed to reproduce every dot from the
      // page alone — the weights in play (published version or what-if), the
      // thresholds and each vendor's composites and box.
      const provenance = buildChartProvenanceLines({
        chartConfig,
        criteria: positioningCriteria,
        weightsInPlay: criteriaWeights,
        isWhatIf,
        thresholds,
        vendors: vendorsWithScores,
        historicalDate: weeksAgo > 0 ? formatDate(selectedDate) : null,
      });
      // Standard PDF fonts only encode WinAnsi; swap anything else (e.g. CJK
      // vendor names) for "?" rather than failing the whole export.
      const winAnsiSafe = (text: string) =>
        text.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, "?");
      for (const line of provenance) line.text = winAnsiSafe(line.text);
      const safeMarketName = winAnsiSafe(marketName);
      const bodySize = 8;
      const lineH = 10.5;
      const blockGap = 18;
      const blockH = provenance.length * lineH + blockGap;

      // Landscape page sized around the chart's aspect ratio, extended by the
      // provenance block (same page, below the chart).
      const margin = 40;
      const titleSize = 18;
      const titleGap = 24;
      const maxImgWidth = 762 - margin * 2;  // ~A4 landscape width in points
      const maxImgHeight = 539 - margin * 2 - titleSize - titleGap;
      const ratio = Math.min(maxImgWidth / svgWidth, maxImgHeight / svgHeight);
      const imgW = svgWidth * ratio;
      const imgH = svgHeight * ratio;
      const widestLine = Math.max(...provenance.map(l => bodyFont.widthOfTextAtSize(l.text, l.bold ? bodySize + 1 : bodySize)));
      const pageW = Math.max(imgW + margin * 2, font.widthOfTextAtSize(safeMarketName, titleSize) + margin * 2, widestLine + margin * 2);
      const pageH = imgH + margin * 2 + titleSize + titleGap + blockH;
      const page = pdfDoc.addPage([pageW, pageH]);

      page.drawText(safeMarketName, {
        x: (pageW - font.widthOfTextAtSize(safeMarketName, titleSize)) / 2,
        y: pageH - margin - titleSize,
        size: titleSize,
        font,
        color: rgb(0.06, 0.09, 0.16),
      });
      page.drawImage(png, {
        x: (pageW - imgW) / 2,
        y: margin + blockH,
        width: imgW,
        height: imgH,
      });
      let cursorY = margin + blockH - blockGap + lineH * (provenance.length - 1);
      const blockX = (pageW - Math.max(imgW, widestLine)) / 2;
      for (const line of provenance) {
        page.drawText(line.text, {
          x: blockX,
          y: cursorY,
          size: line.bold ? bodySize + 1 : bodySize,
          font: line.bold ? font : bodyFont,
          color: line.bold ? rgb(0.06, 0.09, 0.16) : rgb(0.28, 0.33, 0.41),
        });
        cursorY -= lineH;
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${marketName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}.pdf`;
      document.body.appendChild(link);
      link.click();
      const downloadUrl = link.href;
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(downloadUrl);
      }, 1000);
      track("chart_interacted", { marketId, metadata: { action: "pdf_export" } });
    } catch (e) {
      toast({
        title: "Export failed",
        description: "Could not generate the PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const executionCriteria = criteria?.filter(c => c.category === "execution") || [];
  const viabilityCriteria = criteria?.filter(c => c.category === "viability") || [];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-8">
        <div className="lg:col-span-3">
          <Card className={mobileMode ? "rounded-none border border-slate-200 bg-slate-50 shadow-[0_5px_16px_rgba(15,20,24,.06)] font-[Montserrat]" : "bg-white border border-[rgba(226,232,240,0.8)] shadow-[0_4px_16px_rgba(30,41,59,0.14),0_0_0_1px_rgba(79,70,229,0.05)]"}>
            <CardHeader className={mobileMode ? "p-3.5 pb-2" : `${isMobile ? "pb-3" : ""} flex flex-row items-center justify-between`}>
              {mobileMode ? (
                <div className="w-full">
                  <div className="mb-3 flex items-end gap-2 border-b border-slate-200 pb-2">
                    <p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">02</p>
                    <h3 className="text-base font-bold">Vendor positioning</h3>
                  </div>
                  <p className="font-[Menlo] text-[10px] font-bold uppercase tracking-wider text-slate-500">Fixed score domain · 0–100</p>
                </div>
              ) : <CardTitle className={isMobile ? "text-lg" : ""}>{marketName}</CardTitle>}
              <div className="flex items-center gap-2">
              {!mobileMode && isWhatIf && (
                <span
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                  title="Dots are positioned with your slider weights. Reset the sliders to see the published chart."
                  data-testid="badge-what-if"
                >
                  What-if weights
                </span>
              )}
              {!mobileMode && (
              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                title="Export chart as PDF"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 1v8m0 0L4 6m3 3l3-3M2 11v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {isExportingPdf ? "Exporting…" : "Export PDF"}
              </button>
              )}
              </div>
            </CardHeader>
            <CardContent className={mobileMode ? "px-3.5 pb-3.5" : undefined}>
              <div ref={containerRef} className="relative w-full">
                {mobileMode && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">Pinch or use controls to zoom · drag to pan</span>
                    <div className="flex overflow-hidden rounded border border-slate-200 bg-white">
                      <button type="button" aria-label="Zoom out" className="grid h-8 w-8 place-items-center border-r border-slate-200 text-sky-600" onClick={() => setMobileScaleAround(mobileChartScale - .12)}><Minus className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label="Zoom in" className="grid h-8 w-8 place-items-center border-r border-slate-200 text-sky-600" onClick={() => setMobileScaleAround(mobileChartScale + .12)}><Plus className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label="Reset chart to fit" className="flex h-8 items-center gap-1 px-2 text-[10px] font-semibold text-sky-600" onClick={resetMobileChart}><RotateCcw className="h-3 w-3" /> Fit</button>
                    </div>
                  </div>
                )}
                <div
                  ref={mobileMode ? mobileChartViewportRef : undefined}
                  className={mobileMode ? "relative h-[292px] w-full touch-none overflow-hidden overscroll-contain border border-slate-200 bg-white cursor-grab active:cursor-grabbing" : ""}
                  onPointerDown={mobileMode ? onMobileChartPointerDown : undefined}
                  onPointerMove={mobileMode ? onMobileChartPointerMove : undefined}
                  onPointerUp={mobileMode ? onMobileChartPointerUp : undefined}
                  onPointerCancel={mobileMode ? onMobileChartPointerUp : undefined}
                  onWheel={mobileMode ? onMobileChartWheel : undefined}
                >
                  <div
                    style={mobileMode ? { width: 760, height: 547, position: "absolute", left: 0, top: 0, transform: `translate(${mobileChartPan.x}px, ${mobileChartPan.y}px) scale(${mobileChartScale})`, transformOrigin: "top left", willChange: "transform" } : undefined}
                  >
                    <svg
                      ref={svgRef}
                      className={mobileMode ? "block max-w-none bg-white" : "border-2 border-gray-200 rounded-xl bg-white shadow-sm mx-auto"}
                      style={mobileMode ? { width: 760, height: 547, maxWidth: "none" } : undefined}
                    />
                  </div>
                </div>
                {mobileMode && (
                  <div className="flex justify-between px-px pt-2 text-[10px] text-slate-500">
                    <span>0</span><span>Execution / product strategy</span><span>100</span>
                  </div>
                )}

                {/* Evidence popover for the clicked vendor dot */}
                <Popover open={!!evidenceVendor} onOpenChange={(open) => { if (!open) setEvidenceVendor(null); }}>
                  <PopoverTrigger asChild>
                    <button
                      className="absolute w-1 h-1 p-0 border-0 bg-transparent"
                      style={{
                        left: evidenceVendor?.pixelX ?? 0,
                        top: evidenceVendor?.pixelY ?? 0,
                        transform: "translate(-50%, -50%)",
                      }}
                      aria-hidden="true"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="center"
                    sideOffset={12}
                    className="w-80 p-0 bg-white border border-slate-200 shadow-lg rounded-xl overflow-hidden"
                    onPointerDownOutside={() => setEvidenceVendor(null)}
                  >
                    <div className="bg-gradient-to-r from-indigo-50 to-white border-b border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-slate-800 text-sm">{evidenceVendor?.vendor.name}</h4>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Evidence</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">Latest news events</p>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto">
                      {evidenceNews && evidenceNews.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                          {evidenceNews.map((article) => (
                            <a
                              key={article.id}
                              href={article.url || undefined}
                              target={article.url ? "_blank" : undefined}
                              rel={article.url ? "noopener noreferrer" : undefined}
                              className="block p-3 hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                  article.impactLabel === "POSITIVE" ? "bg-emerald-50 text-emerald-600" :
                                  article.impactLabel === "NEGATIVE" ? "bg-red-50 text-red-600" :
                                  "bg-slate-100 text-slate-600"
                                }`}>
                                  {article.impactLabel || "NEUTRAL"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </span>
                              </div>
                              <p className="text-xs text-slate-700 font-medium leading-snug line-clamp-2">{article.title}</p>
                              {article.keyTakeaway && (
                                <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{article.keyTakeaway}</p>
                              )}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center">
                          <p className="text-xs text-slate-500">No recent news events for this vendor.</p>
                        </div>
                      )}
                    </div>
                    <div className="p-2 border-t border-slate-100 bg-slate-50 text-center">
                      <button
                        onClick={() => {
                          if (evidenceVendor) {
                            setSelectedVendor({
                              vendor: evidenceVendor.vendor,
                              position: { x: evidenceVendor.vendor.executionScore, y: evidenceVendor.vendor.viabilityScore }
                            });
                            setEvidenceVendor(null);
                          }
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        View full vendor details →
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Timeline slider: too fiddly for touch and not a mobile
                    priority — hidden on the /mobile/* experience. */}
                {!mobileMode && (
                  <div className={`mt-4 ${isMobile ? 'px-2' : 'px-4'}`}>
                    <label className={`block font-medium text-gray-700 mb-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                      {isMobile ? `${formatDate(selectedDate)}${weeksAgo > 0 ? ` (${weeksAgo}w ago)` : ' (Now)'}` : `Historical View - ${formatDate(selectedDate)} ${weeksAgo > 0 ? ` (${weeksAgo} ${weeksAgo === 1 ? 'week' : 'weeks'} ago)` : ' (Current)'}`}
                    </label>
                    <div className="relative py-1">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-2 top-1/2 z-10 flex h-3 -translate-y-1/2 justify-between"
                        data-testid="timeline-ticks"
                      >
                        {historicalTimelineTicks.map((tick) => (
                          <span
                            key={tick}
                            className="h-3 w-px bg-slate-400/80"
                            style={{ visibility: tick === 0 || tick === HISTORICAL_WEEKS ? "hidden" : "visible" }}
                          />
                        ))}
                      </div>
                      <Slider
                        value={timelineValue}
                        onValueChange={setTimelineValue}
                        max={HISTORICAL_WEEKS}
                        step={1}
                        className="relative z-0 w-full"
                        aria-label="Historical view timeline for the last six months"
                        data-testid="timeline-slider"
                      />
                    </div>
                    <div className={`flex justify-between text-gray-500 mt-1 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                      <span>{isMobile ? formatDate(startDate).replace(', 2022', '') : formatDate(startDate)}</span>
                      <span>{isMobile ? formatDate(today).replace(', 2025', '') : formatDate(today)}</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {!mobileMode && (
          <div className="lg:col-span-1">
            <Card className="h-full flex flex-col bg-white border border-[rgba(226,232,240,0.8)] shadow-[0_4px_16px_rgba(30,41,59,0.14),0_0_0_1px_rgba(79,70,229,0.05)]">
              <CardHeader className={isMobile ? "pb-3" : ""}>
                <CardTitle className={isMobile ? "text-lg" : ""}>Criteria Weights</CardTitle>
                <p className="text-xs text-gray-500 leading-snug" data-testid="text-weights-note">
                  {isWhatIf
                    ? "Showing your what-if view. The published chart uses this market's saved weights."
                    : "Move a slider to build your own what-if view. The published chart uses this market's saved weights."}
                </p>
                {isWhatIf && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 w-fit"
                    onClick={resetWeightsToPublished}
                    data-testid="button-reset-weights"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset to published
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex-1 bg-[#F9FAFC] flex flex-col justify-between">
                <div className="space-y-4">
                  <h4 className="font-bold text-gray-900 mb-3">Product Strategy and Execution</h4>
                  {executionCriteria.map(criterion => (
                    <div key={criterion.id} className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {criterion.name}
                      </label>
                      <Slider
                        value={[criteriaWeights[criterion.id] ?? 100]}
                        onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <div className="text-xs text-gray-500 text-right">
                        {criteriaWeights[criterion.id] ?? 100}%
                      </div>
                    </div>
                  ))}
                  
                </div>

                <hr className="my-6 border-gray-300" />

                <div className="space-y-4">
                  <h4 className="font-bold text-gray-900 mb-3">Vendor Viability</h4>
                  {viabilityCriteria.map(criterion => (
                    <div key={criterion.id} className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {criterion.name}
                      </label>
                      <Slider
                        value={[criteriaWeights[criterion.id] ?? 100]}
                        onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <div className="text-xs text-gray-500 text-right">
                        {criteriaWeights[criterion.id] ?? 100}%
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="mt-8">
        <VendorComparison
          marketId={marketId}
          mobileMode={mobileMode}
          mobileSelectedVendors={mobileSelectedVendors}
          onMobileSelectedVendorsChange={setMobileSelectedVendors}
        />
      </div>

      {mobileMode && (
        <section className="mt-5 font-[Montserrat]">
          <div className="mb-2 flex items-end justify-between border-b border-slate-200 pb-2">
            <div>
              <p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">05</p>
              <h3 className="text-base font-bold">Criteria weights</h3>
            </div>
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 px-2 font-[Menlo] text-[10px] font-bold uppercase tracking-wider text-sky-600"
              onClick={() => setMobileCriteriaOpen(value => !value)}
              aria-expanded={mobileCriteriaOpen}
            >
              {mobileCriteriaOpen ? "Hide" : "Show"}
              <svg className={`h-4 w-4 transition-transform ${mobileCriteriaOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          {mobileCriteriaOpen && (
            <div className="border border-slate-200 bg-slate-50 px-3 shadow-[0_5px_16px_rgba(15,20,24,.06)]">
              {[...executionCriteria, ...viabilityCriteria].map(criterion => (
                <div key={criterion.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-200 py-3 last:border-0">
                  <div>
                    <strong className="block text-xs text-slate-900">{criterion.name}</strong>
                    <small className="mt-0.5 block text-[10px] capitalize text-slate-500">{criterion.category} axis · persisted weight</small>
                  </div>
                  <b className="font-[Menlo] text-xs text-sky-600">{criteriaWeights[criterion.id] ?? 100}%</b>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <Dialog open={!!selectedVendor} onOpenChange={() => setSelectedVendor(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedVendor?.vendor.name}</DialogTitle>
          </DialogHeader>
          
          {selectedVendor && (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className={`grid w-full ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="scores">Scores</TabsTrigger>
                {isAdmin && <TabsTrigger value="notes">Notes</TabsTrigger>}
              </TabsList>
              
              <TabsContent value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Financial Performance</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Revenue:</span>
                        <span className="font-medium">
                          {selectedVendor.vendor.revenue ? 
                            `$${Number(selectedVendor.vendor.revenue).toFixed(1)}B` : 
                            'N/A'
                          }
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Website:</span>
                        <span className="font-medium">
                          {selectedVendor.vendor.website || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Quadrant Position</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Execution composite:</span>
                        <span className="font-medium" data-testid="text-execution-composite">
                          {selectedVendor.vendor.executionComposite.toFixed(2)} / 10
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Viability composite:</span>
                        <span className="font-medium" data-testid="text-viability-composite">
                          {selectedVendor.vendor.viabilityComposite.toFixed(2)} / 10
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Box:</span>
                        <span className="font-medium" data-testid="text-quadrant-box">
                          {selectedVendor.vendor.box.label}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Chart position:</span>
                        <span className="font-medium">
                          ({selectedVendor.position.x.toFixed(1)}, {selectedVendor.position.y.toFixed(1)})
                        </span>
                      </div>
                      {isWhatIf && !selectedVendor.vendor.isHistorical && (
                        <p className="text-xs text-amber-700">
                          Computed with your what-if slider weights, not the published weights.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="scores" className="mt-4">
                <h4 className="font-medium text-gray-900 mb-4">Individual Criteria Scores</h4>
                <div className="space-y-3">
                  {Object.entries(selectedVendor.vendor.scores).map(([criteriaId, score]) => {
                    const criterion = criteria?.find(c => c.id === criteriaId);
                    
                    // Check if this is Product Capabilities criteria (from support matrix calculation)
                    const isProductCapabilities = criterion?.name.toLowerCase().includes('product') && 
                                                 criterion?.name.toLowerCase().includes('capabilities');
                    
                    if (isProductCapabilities) {
                      return (
                        <div key={criteriaId} className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                          <span className="text-gray-900 font-medium">Product Capabilities (Auto-calculated)</span>
                          <span className="font-bold text-green-600 text-lg">
                            {score.toFixed(1)}/10
                          </span>
                        </div>
                      );
                    }
                    
                    if (!criterion) return null;
                    
                    return (
                      <div key={criteriaId} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-900 font-medium">{criterion.name}</span>
                        <span className="font-bold text-blue-600 text-lg">
                          {score.toFixed(1)}/10
                        </span>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
              
              {isAdmin && (
              <TabsContent value="notes" className="mt-4">
                <h4 className="font-medium text-gray-900 mb-4">Criteria Notes</h4>
                <div className="space-y-4">
                  {Object.entries(selectedVendor.vendor.scores).map(([criteriaId, score]) => {
                    const criterion = criteria?.find(c => c.id === criteriaId);
                    const noteKey = `${selectedVendor.vendor.id}-${criteriaId}`;
                    const currentNote = notes[noteKey] || '';
                    
                    // Check if this is Product Capabilities criteria (from support matrix calculation)
                    const isProductCapabilities = criterion?.name.toLowerCase().includes('product') && 
                                                 criterion?.name.toLowerCase().includes('capabilities');
                    
                    if (isProductCapabilities) {
                      return (
                        <div key={criteriaId} className="border rounded-lg p-4">
                          <Label className="font-medium text-gray-900 mb-2 block">
                            Product Capabilities - Auto-calculated (Score: {score.toFixed(1)}/10)
                          </Label>
                          <Textarea
                            placeholder="Add your notes about this vendor's product capabilities..."
                            value={currentNote}
                            onChange={(e) => setNotes(prev => ({ ...prev, [noteKey]: e.target.value }))}
                            className="min-h-[80px]"
                            data-testid={`notes-product-capabilities-${selectedVendor.vendor.id}`}
                          />
                          <Button
                            onClick={() => saveNotesMutation.mutate({
                              vendorId: selectedVendor.vendor.id,
                              criteriaId: criteriaId,
                              notes: currentNote
                            })}
                            className="mt-2"
                            size="sm"
                            disabled={saveNotesMutation.isPending}
                            data-testid={`save-notes-product-capabilities-${selectedVendor.vendor.id}`}
                          >
                            {saveNotesMutation.isPending ? 'Saving...' : 'Save Notes'}
                          </Button>
                        </div>
                      );
                    }
                    
                    if (!criterion) return null;
                    
                    return (
                      <div key={criteriaId} className="border rounded-lg p-4">
                        <Label className="font-medium text-gray-900 mb-2 block">
                          {criterion.name} (Score: {score.toFixed(1)}/10)
                        </Label>
                        <Textarea
                          placeholder={`Add your notes about ${criterion.name}...`}
                          value={currentNote}
                          onChange={(e) => setNotes(prev => ({ ...prev, [noteKey]: e.target.value }))}
                          className="min-h-[80px]"
                          data-testid={`notes-${criteriaId}-${selectedVendor.vendor.id}`}
                        />
                        <Button
                          onClick={() => saveNotesMutation.mutate({
                            vendorId: selectedVendor.vendor.id,
                            criteriaId: criteriaId,
                            notes: currentNote
                          })}
                          className="mt-2"
                          size="sm"
                          disabled={saveNotesMutation.isPending}
                          data-testid={`save-notes-${criteriaId}-${selectedVendor.vendor.id}`}
                        >
                          {saveNotesMutation.isPending ? 'Saving...' : 'Save Notes'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
              )}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <VendorSelectionModal
        open={showVendorModal}
        onOpenChange={setShowVendorModal}
        vendors={vendors || []}
        onGenerate={handleGenerateReport}
        title="Generate Vendor Evaluation Report"
        description="Select vendors to include in the Vendor Evaluation PDF report"
        isGenerating={isGenerating}
      />
    </>
  );
}
