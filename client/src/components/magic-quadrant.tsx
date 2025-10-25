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
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Vendor, VendorScore, Criteria, MarketCriteriaWeight } from "@shared/schema";
import VendorComparison from "./vendor-comparison";
import { useIsMobile } from "@/hooks/use-mobile";

interface MagicQuadrantProps {
  marketId: string;
  marketName: string;
  enableDrag?: boolean; // Enable drag for admin panel
  onLabelPositionChange?: (vendorId: string, x: number, y: number) => void; // Callback for position changes
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

export default function MagicQuadrant({ marketId, marketName, enableDrag = false, onLabelPositionChange }: MagicQuadrantProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timelineValue, setTimelineValue] = useState([156]); // Start at current week (156 weeks = 3 years)
  const [selectedVendor, setSelectedVendor] = useState<VendorModalData | null>(null);
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; vendor?: VendorWithScores } | null>(null);
  const [criteriaWeights, setCriteriaWeights] = useState<{ [id: string]: number }>({});
  const [notes, setNotes] = useState<{ [key: string]: string }>({});
  const [labelPositions, setLabelPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
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
      // Default weights mapping based on criteria names
      const defaultWeightsByName: { [name: string]: number } = {
        'ISV Ecosystem': 100,
        'Innovation': 50,
        'Pricing strategy': 100,
        'Product capabilities': 100,
        'Business Model': 50,
        'Customer experience': 100,
        'Partner Ecosystem': 75,
        'Revenue': 50
      };

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
  }, [weights, criteria]);

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

  // Calculate support matrix scores for product capabilities (excluding ecosystem features)
  const calculateSupportMatrixScore = (vendorId: string): number => {
    if (!features || !supportMatrix) return 0;
    
    // Filter out ecosystem features for product capabilities scoring
    const productCapabilityFeatures = features.filter(feature => 
      !feature.category.name.toLowerCase().includes('ecosystem') &&
      !feature.category.name.toLowerCase().includes('integration') &&
      !feature.category.name.toLowerCase().includes('partnership') &&
      !feature.category.name.toLowerCase().includes('third-party')
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
    const ecosystemFeatures = features.filter(feature => 
      feature.category.name.toLowerCase().includes('ecosystem') ||
      feature.category.name.toLowerCase().includes('integration') ||
      feature.category.name.toLowerCase().includes('partnership') ||
      feature.category.name.toLowerCase().includes('third-party')
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
  const normalizeToRange = (values: number[], min: number = 25, max: number = 75): number[] => {
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
    const height = isMobile ? 350 : 400;
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

    // Add subtle grid lines for better readability
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

    // Add gradient definitions for sophisticated shading
    const defs = svg.append("defs");
    
    // Emerging Players gradient (bottom-left)
    const emergingGradient = defs.append("linearGradient")
      .attr("id", "emergingGradient")
      .attr("gradientUnits", "objectBoundingBox");
    emergingGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#fbbf24")
      .attr("stop-opacity", 0.25);
    emergingGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#f59e0b")
      .attr("stop-opacity", 0.35);

    // Leaders gradient (top-right)
    const leadersGradient = defs.append("linearGradient")
      .attr("id", "leadersGradient")
      .attr("gradientUnits", "objectBoundingBox");
    leadersGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#22c55e")
      .attr("stop-opacity", 0.25);
    leadersGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#16a34a")
      .attr("stop-opacity", 0.35);

    // Challengers gradient (top-left)
    const challengersGradient = defs.append("linearGradient")
      .attr("id", "challengersGradient")
      .attr("gradientUnits", "objectBoundingBox");
    challengersGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#3b82f6")
      .attr("stop-opacity", 0.25);
    challengersGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#1d4ed8")
      .attr("stop-opacity", 0.35);

    // Innovators gradient (bottom-right)
    const innovatorsGradient = defs.append("linearGradient")
      .attr("id", "innovatorsGradient")
      .attr("gradientUnits", "objectBoundingBox");
    innovatorsGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#8b5cf6")
      .attr("stop-opacity", 0.25);
    innovatorsGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#7c3aed")
      .attr("stop-opacity", 0.35);
    
    // Add four distinct 5x5 quadrant backgrounds with improved styling
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const midX = xScale(50);
    const midY = yScale(50);
    
    // Challengers (top-left: 0-50 x, 50-100 y)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", midX - margin.left)
      .attr("height", midY - margin.top)
      .attr("fill", "url(#challengersGradient)")
      .attr("stroke", "#1d4ed8")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);

    // Leaders (top-right: 50-100 x, 50-100 y)
    svg.append("rect")
      .attr("x", midX)
      .attr("y", margin.top)
      .attr("width", width - margin.right - midX)
      .attr("height", midY - margin.top)
      .attr("fill", "url(#leadersGradient)")
      .attr("stroke", "#16a34a")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);
    
    // Emerging Players (bottom-left: 0-50 x, 0-50 y)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", midY)
      .attr("width", midX - margin.left)
      .attr("height", height - margin.bottom - midY)
      .attr("fill", "url(#emergingGradient)")
      .attr("stroke", "#f59e0b")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);

    // Innovators (bottom-right: 50-100 x, 0-50 y)
    svg.append("rect")
      .attr("x", midX)
      .attr("y", midY)
      .attr("width", width - margin.right - midX)
      .attr("height", height - margin.bottom - midY)
      .attr("fill", "url(#innovatorsGradient)")
      .attr("stroke", "#7c3aed")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);

    // Add prominent center dividing lines for 5x5 quadrant structure
    // Vertical center line (x = 50)
    svg.append("line")
      .attr("x1", midX)
      .attr("x2", midX)
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#374151")
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", "5,5");

    // Horizontal center line (y = 50)
    svg.append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", midY)
      .attr("y2", midY)
      .attr("stroke", "#374151")
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", "5,5");

    // Add professional-looking axes
    const xAxis = d3.axisBottom(xScale)
      .tickSize(-chartHeight)
      .tickFormat(d => d === 0 || d === 50 || d === 100 ? `${d}` : '');
    const yAxis = d3.axisLeft(yScale)
      .tickSize(-chartWidth)
      .tickFormat(d => d === 0 || d === 50 || d === 100 ? `${d}` : '');

    svg.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(xAxis)
      .selectAll(".tick line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);

    svg.append("g")
      .attr("class", "y-axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis)
      .selectAll(".tick line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);

    // Style axis text
    svg.selectAll(".x-axis text, .y-axis text")
      .attr("fill", "#64748b")
      .attr("font-size", isMobile ? "10px" : "12px")
      .attr("font-weight", "600");

    // Add professional axis labels
    const axisLabelSize = isMobile ? "11px" : "14px";
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(isMobile ? "Execution" : "Product Strategy and Execution");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("font-size", axisLabelSize)
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text(isMobile ? "Viability" : "Vendor Viability");

    // Add quadrant labels positioned in corners
    const quadrantLabelSize = isMobile ? "10px" : "13px";
    const textShadow = "0 0 3px white, 0 0 3px white, 0 0 3px white";
    const labelOffset = isMobile ? 10 : 15; // Distance from corner
    
    // Challengers label (top-left quadrant - top right corner)
    svg.append("text")
      .attr("x", midX - labelOffset)
      .attr("y", margin.top + labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", quadrantLabelSize)
      .attr("font-weight", "700")
      .attr("fill", "#1d4ed8")
      .style("text-shadow", textShadow)
      .text("Challengers");

    // Leaders label (top-right quadrant - top right corner)
    svg.append("text")
      .attr("x", width - margin.right - labelOffset)
      .attr("y", margin.top + labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", quadrantLabelSize)
      .attr("font-weight", "700")
      .attr("fill", "#16a34a")
      .style("text-shadow", textShadow)
      .text("Leaders");

    // Emerging Players label (bottom-left quadrant - bottom right corner)
    svg.append("text")
      .attr("x", midX - labelOffset)
      .attr("y", height - margin.bottom - labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", quadrantLabelSize)
      .attr("font-weight", "700")
      .attr("fill", "#f59e0b")
      .style("text-shadow", textShadow)
      .text(isMobile ? "Emerging" : "Emerging Players");

    // Innovators label (bottom-right quadrant - bottom right corner)
    svg.append("text")
      .attr("x", width - margin.right - labelOffset)
      .attr("y", height - margin.bottom - labelOffset)
      .attr("text-anchor", "end")
      .attr("font-size", quadrantLabelSize)
      .attr("font-weight", "700")
      .attr("fill", "#7c3aed")
      .style("text-shadow", textShadow)
      .text("Innovators");

    // Enhanced collision detection with stronger separation for overlapping vendors
    const applyCollisionDetection = (vendors: VendorWithScores[]): Array<VendorWithScores & { adjustedX: number, adjustedY: number }> => {
      const minDistance = 45; // Increased minimum distance for better separation
      const iterations = 20; // More iterations for better convergence
      
      const vendorsWithPositions = vendors.map(vendor => ({
        ...vendor,
        adjustedX: vendor.executionScore,
        adjustedY: vendor.viabilityScore,
        originalX: vendor.executionScore,
        originalY: vendor.viabilityScore,
      }));

      // Multi-pass collision detection with stronger forces
      for (let iter = 0; iter < iterations; iter++) {
        let hasChanges = false;
        
        for (let i = 0; i < vendorsWithPositions.length; i++) {
          for (let j = i + 1; j < vendorsWithPositions.length; j++) {
            const v1 = vendorsWithPositions[i];
            const v2 = vendorsWithPositions[j];
            
            const dx = xScale(v1.adjustedX) - xScale(v2.adjustedX);
            const dy = yScale(v1.adjustedY) - yScale(v2.adjustedY);
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < minDistance && distance > 0) {
              hasChanges = true;
              const angle = Math.atan2(dy, dx);
              
              // Use stronger force for closer vendors
              const overlap = minDistance - distance;
              const force = Math.min(overlap / minDistance * 0.6, 0.8); // Stronger force, capped at 0.8
              
              const offsetX = Math.cos(angle) * force * minDistance / 2;
              const offsetY = Math.sin(angle) * force * minDistance / 2;
              
              // Convert back to data coordinates
              const offsetXData = (offsetX / (width - margin.left - margin.right)) * 100;
              const offsetYData = -(offsetY / (height - margin.top - margin.bottom)) * 100;
              
              // Increased maximum deviation for better separation
              const maxDeviation = 15; // Allow larger deviation to avoid overlaps
              const newX1 = v1.adjustedX + offsetXData;
              const newY1 = v1.adjustedY + offsetYData;
              const newX2 = v2.adjustedX - offsetXData;
              const newY2 = v2.adjustedY - offsetYData;
              
              // Apply constraints with bias towards original positions and preserve quadrant boundaries
              const constrainToQuadrant = (originalVal: number, newVal: number, maxDev: number): number => {
                // Determine which side of 50 the original value is on and constrain to same side
                const boundedVal = Math.min(originalVal + maxDev, Math.max(originalVal - maxDev, newVal));
                if (originalVal < 50) {
                  return Math.min(49.5, Math.max(0, boundedVal)); // Keep in left/bottom quadrant
                } else {
                  return Math.min(100, Math.max(50.5, boundedVal)); // Keep in right/top quadrant
                }
              };
              
              v1.adjustedX = constrainToQuadrant(v1.originalX, newX1, maxDeviation);
              v1.adjustedY = constrainToQuadrant(v1.originalY, newY1, maxDeviation);
              v2.adjustedX = constrainToQuadrant(v2.originalX, newX2, maxDeviation);
              v2.adjustedY = constrainToQuadrant(v2.originalY, newY2, maxDeviation);
            }
          }
        }
        
        // Early termination if no changes
        if (!hasChanges) break;
      }
      
      // Final pass: ensure no vendor is completely hidden
      for (let i = 0; i < vendorsWithPositions.length; i++) {
        for (let j = i + 1; j < vendorsWithPositions.length; j++) {
          const v1 = vendorsWithPositions[i];
          const v2 = vendorsWithPositions[j];
          
          const dx = xScale(v1.adjustedX) - xScale(v2.adjustedX);
          const dy = yScale(v1.adjustedY) - yScale(v2.adjustedY);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // If still too close, apply emergency separation
          if (distance < 20) {
            const angle = Math.random() * 2 * Math.PI; // Random direction
            const emergencyOffset = 25; // Minimum emergency separation
            
            const offsetX = Math.cos(angle) * emergencyOffset / 2;
            const offsetY = Math.sin(angle) * emergencyOffset / 2;
            
            const offsetXData = (offsetX / (width - margin.left - margin.right)) * 100;
            const offsetYData = -(offsetY / (height - margin.top - margin.bottom)) * 100;
            
            v1.adjustedX = Math.min(100, Math.max(0, v1.adjustedX + offsetXData));
            v1.adjustedY = Math.min(100, Math.max(0, v1.adjustedY + offsetYData));
            v2.adjustedX = Math.min(100, Math.max(0, v2.adjustedX - offsetXData));
            v2.adjustedY = Math.min(100, Math.max(0, v2.adjustedY - offsetYData));
          }
        }
      }
      
      return vendorsWithPositions;
    };

    const adjustedVendors = applyCollisionDetection(vendorsWithScores);

    // Add enhanced vendor dots with collision detection
    const vendorGroups = svg.selectAll(".vendor-group")
      .data(adjustedVendors)
      .enter()
      .append("g")
      .attr("class", "vendor-group");

    // Add smaller vendor dots for better label visibility
    vendorGroups.append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", 6) // Smaller size to avoid label conflicts
      .attr("fill", "#6366f1")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .style("filter", "drop-shadow(0 2px 4px rgba(99, 102, 241, 0.4))")
      .on("mouseover", function(event, d) {
        d3.select(this)
          .attr("r", 9)
          .attr("stroke-width", 3)
          .style("filter", "drop-shadow(0 3px 6px rgba(99, 102, 241, 0.6))");
          
        // Highlight the label
        const parentGroup = d3.select(this.parentNode as Element);
        const hoverFontSize = isMobile ? 10 : 12;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "700")
          .attr("font-size", `${hoverFontSize}px`);
        parentGroup.select(".label-background")
          .attr("fill", "rgba(255, 255, 255, 1.0)")
          .attr("stroke", "rgba(99, 102, 241, 0.6)");
          
        // Show tooltip with raw and normalized scores
        const svgRect = svgRef.current?.getBoundingClientRect();
        if (svgRect) {
          setTooltip({
            visible: true,
            x: event.clientX - svgRect.left + 10,
            y: event.clientY - svgRect.top - 10,
            vendor: d
          });
        }
      })
      .on("mousemove", function(event, d) {
        // Update tooltip position
        const svgRect = svgRef.current?.getBoundingClientRect();
        if (svgRect && tooltip?.visible) {
          setTooltip(prev => prev ? {
            ...prev,
            x: event.clientX - svgRect.left + 10,
            y: event.clientY - svgRect.top - 10
          } : null);
        }
      })
      .on("mouseout", function(event, d) {
        d3.select(this)
          .attr("r", 6)
          .attr("stroke-width", 2)
          .style("filter", "drop-shadow(0 2px 4px rgba(99, 102, 241, 0.4))");
          
        // Reset the label
        const parentGroup = d3.select(this.parentNode as Element);
        const normalFontSize = isMobile ? 9 : 11;
        parentGroup.select(".vendor-label")
          .attr("font-weight", "600")
          .attr("font-size", `${normalFontSize}px`);
        parentGroup.select(".label-background")
          .attr("fill", "rgba(255, 255, 255, 0.9)")
          .attr("stroke", "rgba(148, 163, 184, 0.4)");
          
        // Hide tooltip
        setTooltip(null);
      })
      .on("click", function(event, d) {
        setSelectedVendor({
          vendor: d,
          position: { x: d.adjustedX, y: d.adjustedY }
        });
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
      
      const labelGroup = vendorGroups.filter((d, i) => i === index);
      
      // Add semi-transparent background for label readability
      const fontSize = isMobile ? 9 : 11;
      const charWidth = isMobile ? 6 : 7.5;
      const textWidth = vendor.name.length * charWidth;
      const labelHeight = isMobile ? 11 : 13;
      let backgroundX, backgroundY;
      
      // Calculate background position based on label side
      if (labelPos.side === "right" || labelPos.side === "custom") {
        backgroundX = labelPos.labelX;
        backgroundY = labelPos.labelY - labelHeight + 3;
      } else if (labelPos.side === "left") {
        backgroundX = labelPos.labelX - textWidth;
        backgroundY = labelPos.labelY - labelHeight + 3;
      } else {
        // top or bottom
        backgroundX = labelPos.labelX - textWidth / 2;
        backgroundY = labelPos.labelY - labelHeight + 3;
      }
      
      const labelBackground = labelGroup.append("rect")
        .attr("class", "label-background")
        .attr("x", backgroundX)
        .attr("y", backgroundY)
        .attr("width", textWidth)
        .attr("height", labelHeight)
        .attr("fill", "rgba(255, 255, 255, 0.9)")
        .attr("stroke", "rgba(148, 163, 184, 0.4)")
        .attr("stroke-width", 1)
        .attr("rx", 3)
        .attr("ry", 3)
        .style("cursor", "move");
      
      // Add the text label positioned around the dot
      const labelText = labelGroup.append("text")
        .attr("class", "vendor-label")
        .attr("x", labelPos.labelX)
        .attr("y", labelPos.labelY)
        .attr("text-anchor", labelPos.anchor)
        .attr("fill", "#1f2937")
        .attr("font-size", `${fontSize}px`)
        .attr("font-weight", "600")
        .style("cursor", "move")
        .text(vendor.name);

      // Add drag behavior to the label (only if enableDrag is true)
      if (enableDrag) {
        const drag = d3.drag()
          .on("start", function(event) {
            d3.select(this.parentNode as Element).raise();
            labelBackground.attr("stroke", "rgba(99, 102, 241, 0.8)").attr("stroke-width", 2);
          })
          .on("drag", function(event) {
            const newX = event.x;
            const newY = event.y;
            
            // Update text position
            labelText.attr("x", newX).attr("y", newY);
            
            // Update background position
            let bgX, bgY;
            if (labelPos.side === "right" || labelPos.side === "custom") {
              bgX = newX;
              bgY = newY - labelHeight + 3;
            } else if (labelPos.side === "left") {
              bgX = newX - textWidth;
              bgY = newY - labelHeight + 3;
            } else {
              bgX = newX - textWidth / 2;
              bgY = newY - labelHeight + 3;
            }
            labelBackground.attr("x", bgX).attr("y", bgY);
          })
          .on("end", function(event) {
            labelBackground.attr("stroke", "rgba(148, 163, 184, 0.4)").attr("stroke-width", 1);
            
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

        // Apply drag to both background and text
        labelBackground.call(drag as any);
        labelText.call(drag as any);
      } else {
        // Remove cursor:move style when not draggable
        labelBackground.style("cursor", "default");
        labelText.style("cursor", "default");
      }
    });

  }, [vendorsWithScores, criteriaWeights, isMobile, labelPositions, enableDrag, onLabelPositionChange, marketId]);

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
            <CardHeader className={isMobile ? "pb-3" : ""}>
              <CardTitle className={isMobile ? "text-lg" : ""}>{marketName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={containerRef} className="relative w-full overflow-x-auto">
                <svg ref={svgRef} className="border-2 border-gray-200 rounded-xl bg-white shadow-sm mx-auto" />
                
                {/* Tooltip for vendor details */}
                {tooltip && tooltip.visible && tooltip.vendor && (
                  <div 
                    className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-3 pointer-events-none"
                    style={{
                      left: tooltip.x,
                      top: tooltip.y,
                      transform: 'translate(-50%, -100%)',
                      minWidth: '200px'
                    }}
                  >
                    <div className="font-semibold text-gray-900 mb-2">{tooltip.vendor.name}</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Product Strategy & Execution:</span>
                        <span className="font-medium">{tooltip.vendor.executionScore.toFixed(1)}</span>
                      </div>
                      {tooltip.vendor.rawExecutionScore !== undefined && (
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Raw Score:</span>
                          <span>{tooltip.vendor.rawExecutionScore.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-600">Vendor Viability:</span>
                        <span className="font-medium">{tooltip.vendor.viabilityScore.toFixed(1)}</span>
                      </div>
                      {tooltip.vendor.rawViabilityScore !== undefined && (
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Raw Score:</span>
                          <span>{tooltip.vendor.rawViabilityScore.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
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
          <Card>
            <CardHeader className={isMobile ? "pb-3" : ""}>
              <CardTitle className={isMobile ? "text-lg" : ""}>Criteria Weights</CardTitle>
            </CardHeader>
            <CardContent className={isMobile ? "space-y-3" : "space-y-4"}>
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Execution Criteria</h4>
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

              <hr className="my-4" />

              <div>
                <h4 className="font-medium text-gray-900 mb-3">Viability Criteria</h4>
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
        <VendorComparison marketId={marketId} />
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
    </>
  );
}
