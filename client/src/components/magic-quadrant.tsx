import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { track } from "@/lib/track";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Vendor, VendorScore, Criteria, MarketCriteriaWeight } from "@shared/schema";
import VendorComparison from "./vendor-comparison";
import { useIsMobile } from "@/hooks/use-mobile";
import { VendorSelectionModal } from "./vendor-selection-modal";

export interface QuadrantSettings {
  dividerY: number;      // 0-100 scale — where the horizontal dividing line sits
  topLabel: string;      // e.g. "DCIG Leaders", "DCIG Top 5", "DCIG Top 3"
  colorTheme: string;    // "dark-blue-gold" | "emerald-coral" | "violet-rose"
}

const DEFAULT_SETTINGS: QuadrantSettings = {
  dividerY: 50,
  topLabel: "DCIG Leaders",
  colorTheme: "dark-blue-gold",
};

interface ColorTheme {
  topFill1: string; topFill2: string; topFillHighlight: string;
  bottomFill1: string; bottomFill2: string; bottomFillHighlight: string;
  topStroke: string; bottomStroke: string;
  topText: string; bottomText: string;
  dotColor: string; dotDark: string;
}

const COLOR_THEMES: Record<string, ColorTheme> = {
  "dark-blue-gold": {
    topFillHighlight: "#F0C84A", topFill2: "#C8961E", topFill1: "#9A6E0E",
    bottomFillHighlight: "#243F7A", bottomFill2: "#1B3A6B", bottomFill1: "#0F2248",
    topStroke: "#D4A822", bottomStroke: "#1B3A6B",
    topText: "#ffffff", bottomText: "#ffffff",
    dotColor: "#C8961E", dotDark: "#7C5209",
  },
  "emerald-coral": {
    topFillHighlight: "#059669", topFill2: "#059669", topFill1: "#059669",
    bottomFillHighlight: "#ea580c", bottomFill2: "#ea580c", bottomFill1: "#ea580c",
    topStroke: "#059669", bottomStroke: "#ea580c",
    topText: "#ffffff", bottomText: "#ffffff",
    dotColor: "#059669", dotDark: "#064e3b",
  },
  "violet-rose": {
    topFillHighlight: "#7c3aed", topFill2: "#7c3aed", topFill1: "#7c3aed",
    bottomFillHighlight: "#e11d48", bottomFill2: "#e11d48", bottomFill1: "#e11d48",
    topStroke: "#7c3aed", bottomStroke: "#e11d48",
    topText: "#ffffff", bottomText: "#ffffff",
    dotColor: "#7c3aed", dotDark: "#4c1d95",
  },
};

interface MagicQuadrantProps {
  marketId: string;
  marketName: string;
  marketType?: "mature" | "emerging";
  enableDrag?: boolean;
  onLabelPositionChange?: (vendorId: string, x: number, y: number) => void;
  quadrantSettings?: QuadrantSettings;
}

interface VendorWithScores extends Vendor {
  scores: { [criteriaId: string]: number };
  executionScore: number;
  viabilityScore: number;
  rawExecutionScore?: number;
  rawViabilityScore?: number;
}

interface VendorModalData {
  vendor: VendorWithScores;
  position: { x: number; y: number };
}

export default function MagicQuadrant({ marketId, marketName, marketType = "mature", enableDrag = false, onLabelPositionChange, quadrantSettings }: MagicQuadrantProps) {
  const settings = { ...DEFAULT_SETTINGS, ...quadrantSettings };
  const theme = COLOR_THEMES[settings.colorTheme] ?? COLOR_THEMES["dark-blue-gold"];
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timelineValue, setTimelineValue] = useState([156]); // Start at current week (156 weeks = 3 years)
  const [showGrid, setShowGrid] = useState(true);
  const [selectedVendor, setSelectedVendor] = useState<VendorModalData | null>(null);
  const [criteriaWeights, setCriteriaWeights] = useState<{ [id: string]: number }>({});
  const [notes, setNotes] = useState<{ [key: string]: string }>({});
  const [labelPositions, setLabelPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Calculate date range for 36 months (156 weeks)
  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 36);
  
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

  const { data: weights, isLoading: weightsLoading } = useQuery<(MarketCriteriaWeight & { criteria: Criteria })[]>({
    queryKey: ["/api/markets", marketId, "weights"],
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  // Query support matrix data for product capabilities scoring
  const { data: features } = useQuery<any[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: supportMatrix } = useQuery<any[]>({
    queryKey: ["/api/markets", marketId, "feature-support"],
  });

  // Query historical positions for the selected date
  const { data: historicalPositions } = useQuery<any[]>({
    queryKey: ["/api/markets", marketId, "historical-positions"],
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
      a.download = `DCIG for ${cleanMarketName} - Vendor Evaluation.pdf`;
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

  // Initialize weights when data loads
  useEffect(() => {
    if (weights && criteria) {
      // Default weights vary by market maturity type.
      // Emerging markets use lower weights for Business Model, Revenue, and Partner Ecosystem.
      const matureDefaults: { [name: string]: number } = {
        'ISV Ecosystem': 100,
        'Innovation': 50,
        'Pricing Strategy': 100,
        'Product Capabilities': 100,
        'Business Model': 50,
        'Customer Experience': 100,
        'Partner Ecosystem': 75,
        'Revenue': 100,
      };
      const emergingOverrides: { [name: string]: number } = {
        'Business Model': 10,
        'Revenue': 10,
        'Partner Ecosystem': 10,
      };
      const defaultWeightsByName = marketType === "emerging"
        ? { ...matureDefaults, ...emergingOverrides }
        : matureDefaults;

      const initialWeights: { [id: string]: number } = {};
      criteria.forEach(c => {
        const existingWeight = weights.find(w => w.criteriaId === c.id);
        if (existingWeight) {
          // Use existing saved weight
          initialWeights[c.id] = existingWeight.weight;
        } else {
          // Use default weight based on criteria name, fallback to 100
          initialWeights[c.id] = defaultWeightsByName[c.name] || 100;
        }
      });
      setCriteriaWeights(initialWeights);
    }
  }, [weights, criteria, marketType]);

  // Load saved label positions
  useEffect(() => {
    if (savedLabelPositions) {
      const positions: { [vendorId: string]: { x: number; y: number } } = {};
      savedLabelPositions.forEach((pos: any) => {
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
  }, []);

  // Calculate support matrix scores for product capabilities (excluding ecosystem features)
  const calculateSupportMatrixScore = (vendorId: string): number => {
    if (!features || !supportMatrix) return 0;
    
    // Filter out ecosystem features for product capabilities scoring
    // Matches support-matrix.tsx exactly: isEcosystem flag (primary) + name-keyword fallback
    const productCapabilityFeatures = features.filter(feature => 
      (feature.category as any).isEcosystem !== true &&
      !feature.category.name.toLowerCase().includes('ecosystem') &&
      !feature.category.name.toLowerCase().includes('integration') &&
      !feature.category.name.toLowerCase().includes('partnership') &&
      !feature.category.name.toLowerCase().includes('third-party') &&
      !feature.category.name.toLowerCase().includes('isv')
    );
    
    // Create support lookup map
    const supportLookup = new Map<string, number>();
    supportMatrix.forEach(support => {
      const key = `${support.vendorId}-${support.featureId}`;
      supportLookup.set(key, support.supportLevel);
    });

    // Calculate vendor's total score for product capabilities only
    const totalScore = productCapabilityFeatures.reduce((sum, feature) => {
      const supportKey = `${vendorId}-${feature.id}`;
      const supportLevel = supportLookup.get(supportKey) || 0;
      
      // Convert support level to score (same as support matrix)
      let score = 0;
      switch (supportLevel) {
        case 4: score = 1.0; break;    // Full support
        case 3: score = 0.75; break;   // Good support
        case 2: score = 0.5; break;    // Partial support
        case 1: score = 0; break;      // Limited support - no score
        case 0: score = 0; break;      // No support - no score
      }
      return sum + score;
    }, 0);

    // Round total to 2 decimals (exactly like Product Evaluation section does)
    const roundedTotal = Number(totalScore.toFixed(2));

    // Calculate maximum possible score
    const maxScore = productCapabilityFeatures.length * 1.0;
    
    // Return normalized score out of 10 (match Product Evaluation section exactly)
    // Product Evaluation: rounds total to 2 decimals, then normalizes, then displays with 1 decimal
    const normalizedScore = maxScore > 0 ? (roundedTotal / maxScore) * 10 : 0;
    return Number(normalizedScore.toFixed(1));
  };

  // Calculate ecosystem support scores
  const calculateEcosystemScore = (vendorId: string): number => {
    if (!features || !supportMatrix) return 0;
    
    // Filter to only ecosystem-related features
    // isEcosystem flag is authoritative when true; name-based is the fallback
    // (is_ecosystem=false is just the DB default, not an intentional exclusion)
    const ecosystemFeatures = features.filter(feature => 
      (feature.category as any).isEcosystem === true ||
      feature.category.name.toLowerCase().includes('ecosystem') ||
      feature.category.name.toLowerCase().includes('integration') ||
      feature.category.name.toLowerCase().includes('partnership') ||
      feature.category.name.toLowerCase().includes('third-party') ||
      feature.category.name.toLowerCase().includes('isv')
    );

    if (ecosystemFeatures.length === 0) return 0;
    
    // Create support lookup map
    const supportLookup = new Map<string, number>();
    supportMatrix.forEach(support => {
      const key = `${support.vendorId}-${support.featureId}`;
      supportLookup.set(key, support.supportLevel);
    });

    // Calculate vendor's total ecosystem score
    const totalScore = ecosystemFeatures.reduce((sum, feature) => {
      const supportKey = `${vendorId}-${feature.id}`;
      const supportLevel = supportLookup.get(supportKey) || 0;
      
      // Convert support level to score (same as ecosystem support component)
      let score = 0;
      switch (supportLevel) {
        case 4: score = 1.0; break;    // Full support
        case 3: score = 0.75; break;   // Good support
        case 2: score = 0.5; break;    // Partial support
        case 1: score = 0; break;      // Limited support
        case 0: score = 0; break;      // No support
      }
      return sum + score;
    }, 0);

    // Calculate maximum possible score
    const maxScore = ecosystemFeatures.length * 1.0;
    
    // Return normalized score out of 10
    return maxScore > 0 ? Number(((totalScore / maxScore) * 10).toFixed(2)) : 0;
  };

  // Weight to multiplier mapping function
  const weightToMultiplier = (weightPercent: number): number => {
    if (weightPercent <= 25) return 0.5;
    if (weightPercent <= 45) return 1.5;
    if (weightPercent <= 65) return 2.5;
    return 3.0; // 65-100%
  };

  // Min-max normalization function
  const normalizeToRange = (values: number[], min: number = 18, max: number = 82): number[] => {
    if (values.length === 0) return [];
    
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    
    // If all values are the same, set all to middle value
    if (rawMax === rawMin) {
      return values.map(() => 50);
    }
    
    return values.map(value => 
      min + (max - min) * (value - rawMin) / (rawMax - rawMin)
    );
  };

  // Calculate raw scores for all vendors first
  const vendorsWithRawScores = (vendors || []).map(vendor => {
    const vendorScores: { [criteriaId: string]: number } = {};
    let executionRawScore = 0;
    let viabilityRawScore = 0;

    // Use historical positions if available and not current week
    if (weeksAgo > 0 && historicalPositions) {
      const historicalPosition = historicalPositions.find(pos => pos.vendorId === vendor.id);
      if (historicalPosition) {
        return {
          vendor,
          vendorScores,
          executionRawScore: parseFloat(historicalPosition.executionScore) || 50,
          viabilityRawScore: parseFloat(historicalPosition.viabilityScore) || 50,
          isHistorical: true
        };
      }
    }

    // Calculate current scores using new multiplier logic
    if (scores && criteria) {
      scores.forEach(score => {
        if (score.vendorId === vendor.id) {
          const scoreValue = parseFloat(score.score);
          vendorScores[score.criteriaId] = scoreValue;
          
          const weight = criteriaWeights[score.criteriaId] || 100;
          const multiplier = weightToMultiplier(weight);
          
          if (score.criteria.category === "execution") {
            executionRawScore += scoreValue * multiplier;
          } else if (score.criteria.category === "viability") {
            viabilityRawScore += scoreValue * multiplier;
          }
        }
      });
    }

    // Add Product Capabilities score from support matrix to execution category
    const supportMatrixScore = calculateSupportMatrixScore(vendor.id);
    const productCapabilitiesCriteria = criteria?.find(c => 
      c.name.toLowerCase().includes('product') && c.name.toLowerCase().includes('capabilities')
    );
    
    if (productCapabilitiesCriteria) {
      // Always use the dynamically calculated score from support matrix
      const weight = criteriaWeights[productCapabilitiesCriteria.id] || 100;
      const multiplier = weightToMultiplier(weight);
      
      // Remove the database score if it exists and replace with calculated score
      if (vendorScores[productCapabilitiesCriteria.id]) {
        // Subtract the old database score from execution
        const oldScore = vendorScores[productCapabilitiesCriteria.id];
        const oldWeight = criteriaWeights[productCapabilitiesCriteria.id] || 100;
        const oldMultiplier = weightToMultiplier(oldWeight);
        executionRawScore -= oldScore * oldMultiplier;
      }
      
      // Add the new calculated score
      executionRawScore += supportMatrixScore * multiplier;
      vendorScores[productCapabilitiesCriteria.id] = supportMatrixScore;
    }

    // Add ISV Ecosystem score from support matrix to execution category
    const ecosystemScore = calculateEcosystemScore(vendor.id);
    if (ecosystemScore > 0) {
      // Find ISV Ecosystem criteria to get its weight
      const isvEcosystemCriteria = criteria?.find(c => 
        c.name.toLowerCase().includes('isv') && c.name.toLowerCase().includes('ecosystem')
      );
      const weight = isvEcosystemCriteria ? criteriaWeights[isvEcosystemCriteria.id] || 100 : 100;
      const multiplier = weightToMultiplier(weight);
      
      executionRawScore += ecosystemScore * multiplier;
      
      if (isvEcosystemCriteria) {
        vendorScores[isvEcosystemCriteria.id] = ecosystemScore;
      } else {
        vendorScores['isv-ecosystem'] = ecosystemScore;
      }
    }

    return {
      vendor,
      vendorScores,
      executionRawScore,
      viabilityRawScore,
      isHistorical: false
    };
  });

  // Build live-computed scores map for VendorComparison so the comparison table
  // shows the same Product Capabilities and ISV Ecosystem scores as the chart/eval tabs
  const computedScoresForComparison: Record<string, Record<string, number>> =
    (features && supportMatrix)
      ? Object.fromEntries(vendorsWithRawScores.map(v => [v.vendor.id, v.vendorScores]))
      : {};

  // Separate current and historical vendors for normalization
  const currentVendors = vendorsWithRawScores.filter(v => !v.isHistorical);
  const historicalVendors = vendorsWithRawScores.filter(v => v.isHistorical);

  // Normalize current vendors' scores
  let normalizedExecutionScores: number[] = [];
  let normalizedViabilityScores: number[] = [];

  if (currentVendors.length > 0) {
    const executionRawScores = currentVendors.map(v => v.executionRawScore);
    const viabilityRawScores = currentVendors.map(v => v.viabilityRawScore);
    
    normalizedExecutionScores = normalizeToRange(executionRawScores);
    normalizedViabilityScores = normalizeToRange(viabilityRawScores);
  }

  // Create final vendor scores array
  const vendorsWithScores: VendorWithScores[] = vendorsWithRawScores.map((vendorData, index) => {
    if (vendorData.isHistorical) {
      return {
        ...vendorData.vendor,
        scores: vendorData.vendorScores,
        executionScore: vendorData.executionRawScore,
        viabilityScore: vendorData.viabilityRawScore,
      };
    }
    
    const currentIndex = currentVendors.findIndex(v => v.vendor.id === vendorData.vendor.id);
    
    return {
      ...vendorData.vendor,
      scores: vendorData.vendorScores,
      executionScore: normalizedExecutionScores[currentIndex] || 50,
      viabilityScore: normalizedViabilityScores[currentIndex] || 50,
      rawExecutionScore: vendorData.executionRawScore,
      rawViabilityScore: vendorData.viabilityRawScore,
    };
  });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || vendorsLoading || scoresLoading || weightsLoading) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Responsive dimensions based on container and device
    const containerWidth = containerRef.current.offsetWidth;
    const width = isMobile ? Math.min(containerWidth - 20, 380) : Math.min(containerWidth, 600);
    // Square grid on desktop: margins are symmetric (L+R = T+B = 80),
    // so an equal width/height yields a perfect square quadrant area.
    const height = isMobile ? 350 : width;
    const margin = isMobile 
      ? { top: 15, right: 15, bottom: 50, left: 50 }
      : { top: 20, right: 20, bottom: 60, left: 60 };

    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    // Add subtle grid lines for better readability (toggleable)
    if (showGrid) {
      svg.selectAll(".grid-line-x")
        .data(xScale.ticks(10))
        .enter()
        .append("line")
        .attr("class", "grid-line-x")
        .attr("x1", d => xScale(d))
        .attr("x2", d => xScale(d))
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom)
        .attr("stroke", "#f1f5f9")
        .attr("stroke-width", 1);

      svg.selectAll(".grid-line-y")
        .data(yScale.ticks(10))
        .enter()
        .append("line")
        .attr("class", "grid-line-y")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", d => yScale(d))
        .attr("y2", d => yScale(d))
        .attr("stroke", "#f1f5f9")
        .attr("stroke-width", 1);
    }

    // ── Two-band Spectio chart layout ────────────────────────────────────────
    const defs = svg.append("defs");
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // ── Metallic 3-stop gradients — tight range gives a polished-surface sheen ──
    const topGradient = defs.append("linearGradient")
      .attr("id", "topBandGradient")
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
    topGradient.append("stop").attr("offset", "0%")
      .attr("stop-color", theme.topFillHighlight).attr("stop-opacity", 1);
    topGradient.append("stop").attr("offset", "45%")
      .attr("stop-color", theme.topFill2).attr("stop-opacity", 1);
    topGradient.append("stop").attr("offset", "100%")
      .attr("stop-color", theme.topFill1).attr("stop-opacity", 1);

    const bottomGradient = defs.append("linearGradient")
      .attr("id", "bottomBandGradient")
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
    bottomGradient.append("stop").attr("offset", "0%")
      .attr("stop-color", theme.bottomFillHighlight).attr("stop-opacity", 1);
    bottomGradient.append("stop").attr("offset", "45%")
      .attr("stop-color", theme.bottomFill2).attr("stop-opacity", 1);
    bottomGradient.append("stop").attr("offset", "100%")
      .attr("stop-color", theme.bottomFill1).attr("stop-opacity", 1);


    // Compute the Y pixel position of the dividing line
    const divY = yScale(settings.dividerY);
    const topBandH = Math.max(0, divY - margin.top);
    const bottomBandH = Math.max(0, height - margin.bottom - divY);

    // Top band — flat gold, sharp corners
    svg.append("rect")
      .attr("x", margin.left).attr("y", margin.top)
      .attr("width", chartWidth).attr("height", topBandH)
      .attr("fill", "url(#topBandGradient)")
      .attr("stroke", theme.topStroke).attr("stroke-width", 1.5);

    // Bottom band — flat navy, sharp corners
    svg.append("rect")
      .attr("x", margin.left).attr("y", divY)
      .attr("width", chartWidth).attr("height", bottomBandH)
      .attr("fill", "url(#bottomBandGradient)")
      .attr("stroke", theme.bottomStroke).attr("stroke-width", 1.5);

    // Dividing line — solid, bright, with glow
    svg.append("line")
      .attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", divY).attr("y2", divY)
      .attr("stroke", theme.topStroke)
      .attr("stroke-width", 3)
      .style("filter", `drop-shadow(0 0 4px ${theme.topStroke})`);

    // Add professional-looking axes (tick lines hidden when grid is off)
    const xAxis = d3.axisBottom(xScale)
      .tickSize(showGrid ? -chartHeight : 0)
      .tickSizeOuter(0)
      .tickFormat(d => d === 0 || d === 50 || d === 100 ? `${d}` : '');
    const yAxis = d3.axisLeft(yScale)
      .tickSize(showGrid ? -chartWidth : 0)
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
      .attr("font-size", isMobile ? "10px" : "12px")
      .attr("font-weight", "600");

    // Add professional axis labels — positioned close to the chart box
    const axisLabelSize = isMobile ? "11px" : "14px";
    // X-axis label: sits just below the tick numbers (margin.bottom - 8px clearance)
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - margin.bottom + (isMobile ? 32 : 36))
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(isMobile ? "Execution →" : "Product Strategy and Execution →");

    // Y-axis label: positioned left of the tick numbers to avoid overlapping "50"
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", isMobile ? 12 : 18)
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(isMobile ? "Viability →" : "Vendor Viability →");

    // DCIG Inc. watermark — bottom right, outside the grid
    svg.append("text")
      .attr("x", width - margin.right)
      .attr("y", height - (isMobile ? 4 : 6))
      .attr("text-anchor", "end")
      .attr("font-size", isMobile ? "9px" : "11px")
      .attr("font-weight", "500")
      .attr("fill", "#94a3b8")
      .text("Powered by DCIG.ai");

    // ── Two-band zone labels ─────────────────────────────────────────────────
    const bandLabelSize = isMobile ? "11px" : "14px";
    const labelOffset = isMobile ? 10 : 15;
    const textShadow = "0 1px 3px rgba(255,255,255,0.9), 0 1px 3px rgba(255,255,255,0.9)";

    // Top band label — white text + coloured glow for glossy contrast
    svg.append("text")
      .attr("x", width - margin.right - labelOffset)
      .attr("y", margin.top + labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", bandLabelSize)
      .attr("font-weight", "800")
      .attr("fill", "#ffffff")
      .attr("letter-spacing", "0.5")
      .style("filter", `drop-shadow(0 1px 4px ${theme.topStroke})`)
      .text(settings.topLabel);

    // Bottom band label — white text + coloured glow
    svg.append("text")
      .attr("x", width - margin.right - labelOffset)
      .attr("y", height - margin.bottom - labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", bandLabelSize)
      .attr("font-weight", "800")
      .attr("fill", "#ffffff")
      .attr("letter-spacing", "0.5")
      .style("filter", `drop-shadow(0 1px 4px ${theme.bottomStroke})`)
      .text(isMobile ? "Emerging" : "Emerging Players");

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
      .attr("class", "vendor-group");

    // Vendor dots — original size, white fill with themed stroke for clean executive look
    vendorGroups.append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", 6)
      .attr("fill", "#ffffff")
      .attr("stroke", theme.dotColor)
      .attr("stroke-width", 2.5)
      .style("cursor", "pointer")
      .style("filter", `drop-shadow(0 2px 5px ${theme.dotDark}99)`)
      .on("mouseover", function(event, d) {
        d3.select(this)
          .attr("r", 9)
          .attr("stroke-width", 3)
          .style("filter", `drop-shadow(0 3px 8px ${theme.dotDark}cc)`);
        const parentGroup = d3.select(this.parentNode as Element);
        const hoverFontSize = isMobile ? 10 : 12;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "700")
          .attr("font-size", `${hoverFontSize}px`);
      })
      .on("mouseout", function(event, d) {
        d3.select(this)
          .attr("r", 6)
          .attr("stroke-width", 2.5)
          .style("filter", `drop-shadow(0 2px 5px ${theme.dotDark}99)`);
        const parentGroup = d3.select(this.parentNode as Element);
        const normalFontSize = isMobile ? 9 : 11;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "600")
          .attr("font-size", `${normalFontSize}px`);
      })
      .on("click", function(event, d) {
        setSelectedVendor({
          vendor: d,
          position: { x: d.adjustedX, y: d.adjustedY }
        });
        track("chart_interacted", { marketId, vendorId: (d as any).id ?? null, metadata: { vendorName: (d as any).name } });
        track("vendor_viewed", { marketId, vendorId: (d as any).id ?? null, metadata: { vendorName: (d as any).name } });
      });

    // Enhanced four-direction label positioning with collision detection
    const calculateLabelPosition = (vendor: typeof adjustedVendors[0], index: number, allVendors: typeof adjustedVendors): { 
      labelX: number, labelY: number, anchor: string, dotX: number, dotY: number, side: string
    } => {
      const dotX = xScale(vendor.adjustedX);
      const dotY = yScale(vendor.adjustedY);
      const labelOffset = 12; // Direct adjacent positioning
      const textWidth = vendor.name.length * 7.5;
      const labelHeight = 16;
      
      // All four positions: right, left, top, bottom
      const positions = [
        { x: dotX + labelOffset, y: dotY + 4, anchor: "start", side: "right" }, // right (preferred)
        { x: dotX - labelOffset, y: dotY + 4, anchor: "end", side: "left" },     // left
        { x: dotX, y: dotY - labelOffset - 4, anchor: "middle", side: "top" },   // top
        { x: dotX, y: dotY + labelOffset + 12, anchor: "middle", side: "bottom" } // bottom
      ];
      
      // Check each position for conflicts
      for (const position of positions) {
        let hasConflict = false;
        
        // Calculate label bounds based on position
        let labelLeft, labelRight, labelTop, labelBottom;
        
        if (position.side === "right" || position.side === "left") {
          // Horizontal labels
          labelLeft = position.anchor === "end" ? position.x - textWidth : position.x;
          labelRight = labelLeft + textWidth;
          labelTop = position.y - 12;
          labelBottom = position.y + 4;
        } else {
          // Vertical labels (top/bottom)
          labelLeft = position.x - textWidth / 2;
          labelRight = position.x + textWidth / 2;
          labelTop = position.y - 12;
          labelBottom = position.y + 4;
        }
        
        // Check chart bounds
        if (labelLeft < margin.left + 5 || labelRight > width - margin.right - 5 || 
            labelTop < margin.top + 5 || labelBottom > height - margin.bottom - 5) {
          continue;
        }
        
        // Check conflicts with other vendor dots and labels
        for (let i = 0; i < allVendors.length; i++) {
          if (i === index) continue;
          
          const otherVendor = allVendors[i];
          const otherX = xScale(otherVendor.adjustedX);
          const otherY = yScale(otherVendor.adjustedY);
          
          // Check distance to other dots (minimum 15px clearance)
          const distanceToOtherDot = Math.sqrt((position.x - otherX) ** 2 + (position.y - otherY) ** 2);
          if (distanceToOtherDot < 15) {
            hasConflict = true;
            break;
          }
          
          // Check for label overlap with other potential label positions
          const otherTextWidth = otherVendor.name.length * 7.5;
          const otherLabelPositions = [
            { x: otherX + labelOffset, anchor: "start", side: "right" },
            { x: otherX - labelOffset, anchor: "end", side: "left" },
            { x: otherX, anchor: "middle", side: "top" },
            { x: otherX, anchor: "middle", side: "bottom" }
          ];
          
          for (const otherPos of otherLabelPositions) {
            let otherLabelLeft, otherLabelRight, otherLabelTop, otherLabelBottom;
            
            if (otherPos.side === "right" || otherPos.side === "left") {
              otherLabelLeft = otherPos.anchor === "end" ? otherPos.x - otherTextWidth : otherPos.x;
              otherLabelRight = otherLabelLeft + otherTextWidth;
              otherLabelTop = otherY - 8;
              otherLabelBottom = otherY + 8;
            } else {
              otherLabelLeft = otherPos.x - otherTextWidth / 2;
              otherLabelRight = otherPos.x + otherTextWidth / 2;
              otherLabelTop = otherPos.side === "top" ? otherY - labelOffset - 16 : otherY + labelOffset;
              otherLabelBottom = otherLabelTop + 16;
            }
            
            // Check for rectangle overlap
            if (!(labelRight < otherLabelLeft || labelLeft > otherLabelRight || 
                  labelBottom < otherLabelTop || labelTop > otherLabelBottom)) {
              hasConflict = true;
              break;
            }
          }
          
          if (hasConflict) break;
        }
        
        if (!hasConflict) {
          return {
            labelX: position.x,
            labelY: position.y,
            anchor: position.anchor,
            side: position.side,
            dotX,
            dotY
          };
        }
      }
      
      // Fallback to right position (may overlap but at least visible)
      return {
        labelX: dotX + labelOffset,
        labelY: dotY + 4,
        anchor: "start",
        side: "right",
        dotX,
        dotY
      };
    };

    // Add vendor labels positioned in all four directions around dots
    adjustedVendors.forEach((vendor, index) => {
      // Check if we have a custom position for this vendor
      const customPos = labelPositions[vendor.id];
      const labelPos = customPos 
        ? { labelX: customPos.x, labelY: customPos.y, anchor: "start", side: "custom", dotX: xScale(vendor.adjustedX), dotY: yScale(vendor.adjustedY) }
        : calculateLabelPosition(vendor, index, adjustedVendors);

      // Keep every label inside the drawable chart area. Saved/auto positions
      // can land outside the box (e.g. after the chart was made smaller), which
      // clips the text off-screen — the dot stays but its label "disappears".
      // Clamping is a no-op for labels already in bounds, so nothing else moves.
      const lblWidth = vendor.name.length * 7.5;
      const minLabelX = margin.left + 2;
      const maxLabelX = width - margin.right - 2;
      const minLabelY = margin.top + 10;
      const maxLabelY = height - margin.bottom - 2;
      if (labelPos.anchor === "end") {
        labelPos.labelX = Math.min(maxLabelX, Math.max(labelPos.labelX, minLabelX + lblWidth));
      } else if (labelPos.anchor === "middle") {
        labelPos.labelX = Math.max(minLabelX + lblWidth / 2, Math.min(labelPos.labelX, maxLabelX - lblWidth / 2));
      } else {
        labelPos.labelX = Math.max(minLabelX, Math.min(labelPos.labelX, maxLabelX - lblWidth));
      }
      labelPos.labelY = Math.max(minLabelY, Math.min(labelPos.labelY, maxLabelY));

      const labelGroup = vendorGroups.filter((d, i) => i === index);

      // Add the text label positioned around the dot
      const fontSize = isMobile ? 9 : 11;
      const inBottomBand = vendor.adjustedY < settings.dividerY;
      const labelText = labelGroup.append("text")
        .attr("class", "vendor-label")
        .attr("x", labelPos.labelX)
        .attr("y", labelPos.labelY)
        .attr("text-anchor", labelPos.anchor)
        .attr("fill", inBottomBand ? "#ffffff" : "#1f2937")
        .attr("font-size", `${fontSize}px`)
        .attr("font-weight", "600")
        .style("cursor", "move")
        .text(vendor.name);

      // Add drag behavior to the label (only if enableDrag is true)
      if (enableDrag) {
        const drag = d3.drag()
          .on("start", function(event) {
            d3.select(this.parentNode as Element).raise();
          })
          .on("drag", function(event) {
            const newX = event.x;
            const newY = event.y;
            
            // Update text position
            labelText.attr("x", newX).attr("y", newY);
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
      } else {
        // Remove cursor:move style when not draggable
        labelText.style("cursor", "default");
      }
    });

  }, [vendorsWithScores, criteriaWeights, isMobile, labelPositions, enableDrag, onLabelPositionChange, marketId, containerWidth, quadrantSettings, showGrid]);

  const handleWeightChange = (criteriaId: string, newWeight: number) => {
    setCriteriaWeights(prev => ({
      ...prev,
      [criteriaId]: newWeight
    }));
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

  const executionCriteria = criteria?.filter(c => c.category === "execution") || [];
  const viabilityCriteria = criteria?.filter(c => c.category === "viability") || [];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-8">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className={`${isMobile ? "pb-3" : ""} flex flex-row items-center justify-between`}>
              <CardTitle className={isMobile ? "text-lg" : ""}>{marketName}</CardTitle>
              <button
                onClick={() => setShowGrid(g => !g)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  showGrid
                    ? "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
                    : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
                }`}
                title={showGrid ? "Hide grid lines" : "Show grid lines"}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 4.5h12M1 9.5h12M4.5 1v12M9.5 1v12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {showGrid ? "Grid on" : "Grid off"}
              </button>
            </CardHeader>
            <CardContent>
              <div ref={containerRef} className="relative w-full overflow-x-auto">
                <svg ref={svgRef} className="border-2 border-gray-200 rounded-xl bg-white shadow-sm mx-auto" />
                
                <div className={`mt-4 ${isMobile ? 'px-2' : 'px-4'}`}>
                  <label className={`block font-medium text-gray-700 mb-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                    {isMobile ? `${formatDate(selectedDate)}${weeksAgo > 0 ? ` (${weeksAgo}w ago)` : ' (Now)'}` : `Historical View - ${formatDate(selectedDate)} ${weeksAgo > 0 ? ` (${weeksAgo} ${weeksAgo === 1 ? 'week' : 'weeks'} ago)` : ' (Current)'}`}
                  </label>
                  <Slider
                    value={timelineValue}
                    onValueChange={setTimelineValue}
                    max={156}
                    step={1}
                    className="w-full"
                    data-testid="timeline-slider"
                  />
                  <div className={`flex justify-between text-gray-500 mt-1 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                    <span>{isMobile ? formatDate(startDate).replace(', 2022', '') : formatDate(startDate)}</span>
                    <span>{isMobile ? formatDate(today).replace(', 2025', '') : formatDate(today)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader className={isMobile ? "pb-3" : ""}>
              <CardTitle className={isMobile ? "text-lg" : ""}>Criteria Weights</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 bg-gray-100 flex flex-col justify-between">
              <div className="space-y-4">
                <h4 className="font-bold text-gray-900 mb-3">Product Strategy and Execution</h4>
                {executionCriteria.map(criterion => (
                  <div key={criterion.id} className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {criterion.name}
                    </label>
                    <Slider
                      value={[criteriaWeights[criterion.id] || 100]}
                      onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-500 text-right">
                      {criteriaWeights[criterion.id] || 100}%
                    </div>
                  </div>
                ))}
                
                {/* Product Capabilities from Support Matrix */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Capabilities (Auto)
                  </label>
                  <div className="bg-green-50 p-2 rounded-md">
                    <div className="text-xs text-green-700">
                      Automatically calculated from Support Matrix
                    </div>
                    <div className="text-xs text-gray-500 text-right mt-1">
                      25% (Fixed Weight)
                    </div>
                  </div>
                </div>
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
                      value={[criteriaWeights[criterion.id] || 100]}
                      onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-500 text-right">
                      {criteriaWeights[criterion.id] || 100}%
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <VendorComparison marketId={marketId} computedScores={computedScoresForComparison} />
      </div>

      <Dialog open={!!selectedVendor} onOpenChange={() => setSelectedVendor(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedVendor?.vendor.name}</DialogTitle>
          </DialogHeader>
          
          {selectedVendor && (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="scores">Scores</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
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
                        <span className="text-gray-600">Execution Score:</span>
                        <span className="font-medium">
                          {selectedVendor.vendor.executionScore.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Viability Score:</span>
                        <span className="font-medium">
                          {selectedVendor.vendor.viabilityScore.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Position:</span>
                        <span className="font-medium">
                          ({selectedVendor.position.x.toFixed(1)}, {selectedVendor.position.y.toFixed(1)})
                        </span>
                      </div>
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
