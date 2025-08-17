import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Vendor, VendorScore, Criteria, MarketCriteriaWeight } from "@shared/schema";

interface MagicQuadrantProps {
  marketId: string;
  marketName: string;
}

interface VendorWithScores extends Vendor {
  scores: { [criteriaId: string]: number };
  executionScore: number;
  viabilityScore: number;
}

interface VendorModalData {
  vendor: VendorWithScores;
  position: { x: number; y: number };
}

export default function MagicQuadrant({ marketId, marketName }: MagicQuadrantProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [timelineValue, setTimelineValue] = useState([156]); // Start at current week (156 weeks = 3 years)
  const [selectedVendor, setSelectedVendor] = useState<VendorModalData | null>(null);
  const [criteriaWeights, setCriteriaWeights] = useState<{ [id: string]: number }>({});

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

  // Initialize weights when data loads
  useEffect(() => {
    if (weights && criteria) {
      const initialWeights: { [id: string]: number } = {};
      criteria.forEach(c => {
        const weight = weights.find(w => w.criteriaId === c.id);
        initialWeights[c.id] = weight?.weight || 100;
      });
      setCriteriaWeights(initialWeights);
    }
  }, [weights, criteria]);

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

    // Calculate maximum possible score
    const maxScore = productCapabilityFeatures.length * 1.0;
    
    // Return normalized score out of 10
    return maxScore > 0 ? Number(((totalScore / maxScore) * 10).toFixed(2)) : 0;
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

  // Calculate vendor positions (use historical data if available and not current week)
  const vendorsWithScores: VendorWithScores[] = (vendors || []).map(vendor => {
    const vendorScores: { [criteriaId: string]: number } = {};
    let executionTotal = 0;
    let viabilityTotal = 0;
    let executionWeight = 0;
    let viabilityWeight = 0;

    // Use historical positions if available and not current week
    if (weeksAgo > 0 && historicalPositions) {
      const historicalPosition = historicalPositions.find(pos => pos.vendorId === vendor.id);
      if (historicalPosition) {
        return {
          ...vendor,
          scores: vendorScores,
          executionScore: parseFloat(historicalPosition.executionScore) || 50,
          viabilityScore: parseFloat(historicalPosition.viabilityScore) || 50,
        };
      }
    }

    // Use current scores for current week or when no historical data
    if (scores && criteria) {
      scores.forEach(score => {
        if (score.vendorId === vendor.id) {
          vendorScores[score.criteriaId] = parseFloat(score.score);
          
          const weight = criteriaWeights[score.criteriaId] || 25;
          if (score.criteria.category === "execution") {
            executionTotal += parseFloat(score.score) * weight;
            executionWeight += weight;
          } else if (score.criteria.category === "viability") {
            viabilityTotal += parseFloat(score.score) * weight;
            viabilityWeight += weight;
          }
        }
      });
    }

    // Add Product Capabilities score from support matrix to execution category
    const supportMatrixScore = calculateSupportMatrixScore(vendor.id);
    if (supportMatrixScore > 0) {
      const productCapabilitiesWeight = 25; // Same weight as other criteria
      executionTotal += supportMatrixScore * productCapabilitiesWeight;
      executionWeight += productCapabilitiesWeight;
      
      // Add to vendor scores for display purposes
      vendorScores['product-capabilities'] = supportMatrixScore;
    }

    // Add Ecosystem Support score from support matrix to execution category (ISV Ecosystem)
    const ecosystemScore = calculateEcosystemScore(vendor.id);
    if (ecosystemScore > 0) {
      const ecosystemWeight = 25; // Same weight as other criteria
      executionTotal += ecosystemScore * ecosystemWeight;
      executionWeight += ecosystemWeight;
      
      // Add to vendor scores for display purposes - look for ISV ecosystem criterion
      const isvEcosystemCriteria = criteria?.find(c => 
        c.name.toLowerCase().includes('isv') && c.name.toLowerCase().includes('ecosystem')
      );
      if (isvEcosystemCriteria) {
        vendorScores[isvEcosystemCriteria.id] = ecosystemScore;
      } else {
        // Fallback: use a standard key for ecosystem scores
        vendorScores['isv-ecosystem'] = ecosystemScore;
      }
    }

    // Convert 0-10 scores to 0-100 scale for proper quadrant positioning
    const executionScore = executionWeight > 0 ? (executionTotal / executionWeight) * 10 : 50;
    const viabilityScore = viabilityWeight > 0 ? (viabilityTotal / viabilityWeight) * 10 : 50;
    
    return {
      ...vendor,
      scores: vendorScores,
      executionScore,
      viabilityScore,
    };
  });

  useEffect(() => {
    if (!svgRef.current || vendorsLoading || scoresLoading || weightsLoading) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 600;
    const height = 400;
    const margin = { top: 20, right: 20, bottom: 60, left: 60 };

    svg.attr("width", width).attr("height", height);

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
    
    // Emerging Players gradient
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

    // Leaders gradient
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

    // Challengers gradient
    const challengersGradient = defs.append("linearGradient")
      .attr("id", "challengersGradient")
      .attr("gradientUnits", "objectBoundingBox");
    challengersGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#3b82f6")
      .attr("stop-opacity", 0.15);
    challengersGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#1d4ed8")
      .attr("stop-opacity", 0.25);
    
    // Add custom quadrant backgrounds with improved styling
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    // Challengers (entire background - subtle blue)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", chartWidth)
      .attr("height", chartHeight)
      .attr("fill", "url(#challengersGradient)")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);
    
    // Emerging Players (bottom-left 30x30 coordinates)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", yScale(30))
      .attr("width", xScale(30) - margin.left)
      .attr("height", height - margin.bottom - yScale(30))
      .attr("fill", "url(#emergingGradient)")
      .attr("stroke", "#f59e0b")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);

    // Leaders (top-right 60-100 x 60-100 coordinates - 40x40 area)
    svg.append("rect")
      .attr("x", xScale(60))
      .attr("y", margin.top)
      .attr("width", width - margin.right - xScale(60))
      .attr("height", yScale(60) - margin.top)
      .attr("fill", "url(#leadersGradient)")
      .attr("stroke", "#16a34a")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8);

    // Add professional-looking axes
    const xAxis = d3.axisBottom(xScale)
      .tickSize(-chartHeight)
      .tickFormat(d => d === 0 || d === 100 ? `${d}` : '');
    const yAxis = d3.axisLeft(yScale)
      .tickSize(-chartWidth)
      .tickFormat(d => d === 0 || d === 100 ? `${d}` : '');

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
      .attr("font-size", "12px")
      .attr("font-weight", "600");

    // Add professional axis labels
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("class", "text-base font-semibold")
      .attr("fill", "#374151")
      .text("Product Strategy and Execution");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("class", "text-base font-semibold")
      .attr("fill", "#374151")
      .text("Vendor Viability");

    // Add clean quadrant labels without background boxes
    // Emerging Players label (bottom-left corner)
    svg.append("text")
      .attr("x", margin.left + 55)
      .attr("y", height - margin.bottom - 11)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "#f59e0b")
      .style("text-shadow", "0 0 3px white, 0 0 3px white, 0 0 3px white")
      .text("Emerging Players");

    // Leaders label (top-right corner)
    svg.append("text")
      .attr("x", width - margin.right - 30)
      .attr("y", margin.top + 19)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "#16a34a")
      .style("text-shadow", "0 0 3px white, 0 0 3px white, 0 0 3px white")
      .text("Leaders");

    // Challengers label (positioned in top-left corner)
    svg.append("text")
      .attr("x", margin.left + 45)
      .attr("y", margin.top + 19)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "#1d4ed8")
      .style("text-shadow", "0 0 3px white, 0 0 3px white, 0 0 3px white")
      .text("Challengers");

    // Enhanced collision detection and spacing with force simulation approach
    const applyCollisionDetection = (vendors: VendorWithScores[]): Array<VendorWithScores & { adjustedX: number, adjustedY: number }> => {
      const minDistance = 35; // Increased minimum distance for better visibility
      const iterations = 10; // Number of force simulation iterations
      
      const vendorsWithPositions = vendors.map(vendor => ({
        ...vendor,
        adjustedX: vendor.executionScore,
        adjustedY: vendor.viabilityScore,
        originalX: vendor.executionScore,
        originalY: vendor.viabilityScore,
      }));

      // Force-based collision detection with multiple iterations
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < vendorsWithPositions.length; i++) {
          for (let j = i + 1; j < vendorsWithPositions.length; j++) {
            const v1 = vendorsWithPositions[i];
            const v2 = vendorsWithPositions[j];
            
            const dx = xScale(v1.adjustedX) - xScale(v2.adjustedX);
            const dy = yScale(v1.adjustedY) - yScale(v2.adjustedY);
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < minDistance && distance > 0) {
              const angle = Math.atan2(dy, dx);
              const targetDistance = minDistance;
              const force = (targetDistance - distance) / targetDistance * 0.2; // Reduced force for smoother adjustment
              
              const offsetX = Math.cos(angle) * force * targetDistance / 2;
              const offsetY = Math.sin(angle) * force * targetDistance / 2;
              
              // Convert back to data coordinates
              const offsetXData = (offsetX / (width - margin.left - margin.right)) * 100;
              const offsetYData = -(offsetY / (height - margin.top - margin.bottom)) * 100;
              
              // Apply forces while keeping vendors close to original positions
              const maxDeviation = 8; // Maximum deviation from original position
              const newX1 = v1.adjustedX + offsetXData;
              const newY1 = v1.adjustedY + offsetYData;
              const newX2 = v2.adjustedX - offsetXData;
              const newY2 = v2.adjustedY - offsetYData;
              
              // Constrain to max deviation and chart bounds
              v1.adjustedX = Math.min(100, Math.max(0, Math.min(v1.originalX + maxDeviation, Math.max(v1.originalX - maxDeviation, newX1))));
              v1.adjustedY = Math.min(100, Math.max(0, Math.min(v1.originalY + maxDeviation, Math.max(v1.originalY - maxDeviation, newY1))));
              v2.adjustedX = Math.min(100, Math.max(0, Math.min(v2.originalX + maxDeviation, Math.max(v2.originalX - maxDeviation, newX2))));
              v2.adjustedY = Math.min(100, Math.max(0, Math.min(v2.originalY + maxDeviation, Math.max(v2.originalY - maxDeviation, newY2))));
            }
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

    // Add enhanced vendor dots with better visibility
    vendorGroups.append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", 10) // Increased base size for better visibility
      .attr("fill", "#6366f1")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 3)
      .style("cursor", "pointer")
      .style("filter", "drop-shadow(0 3px 6px rgba(99, 102, 241, 0.4))")
      .on("mouseover", function(event, d) {
        d3.select(this)
          .attr("r", 14)
          .attr("stroke-width", 4)
          .style("filter", "drop-shadow(0 4px 8px rgba(99, 102, 241, 0.6))");
          
        // Highlight the label
        d3.select(this.parentNode)
          .select(".vendor-label")
          .attr("font-weight", "700")
          .attr("font-size", "12px");
      })
      .on("mouseout", function(event, d) {
        d3.select(this)
          .attr("r", 10)
          .attr("stroke-width", 3)
          .style("filter", "drop-shadow(0 3px 6px rgba(99, 102, 241, 0.4))");
          
        // Reset the label
        d3.select(this.parentNode)
          .select(".vendor-label")
          .attr("font-weight", "600")
          .attr("font-size", "11px");
      })
      .on("click", function(event, d) {
        setSelectedVendor({
          vendor: d,
          position: { x: d.adjustedX, y: d.adjustedY }
        });
      });

    // Enhanced label positioning with better conflict detection and readability
    const calculateLabelPosition = (vendor: typeof adjustedVendors[0], index: number, allVendors: typeof adjustedVendors): { x: number, y: number, anchor: string, background?: boolean } => {
      const baseX = xScale(vendor.adjustedX);
      const baseY = yScale(vendor.adjustedY);
      const labelOffset = 20; // Increased offset for better readability
      const textWidth = vendor.name.length * 7; // Estimate text width
      
      // Preferred positions with better spacing (prioritize top and bottom for readability)
      const positions = [
        { x: baseX, y: baseY - labelOffset, anchor: "middle", priority: 1, bounds: { width: textWidth, height: 12 } }, // top
        { x: baseX, y: baseY + labelOffset + 8, anchor: "middle", priority: 2, bounds: { width: textWidth, height: 12 } }, // bottom
        { x: baseX - labelOffset - 5, y: baseY + 4, anchor: "end", priority: 3, bounds: { width: textWidth, height: 12 } }, // left
        { x: baseX + labelOffset + 5, y: baseY + 4, anchor: "start", priority: 4, bounds: { width: textWidth, height: 12 } }, // right
        { x: baseX - labelOffset * 0.7, y: baseY - labelOffset * 0.7, anchor: "end", priority: 5, bounds: { width: textWidth, height: 12 } }, // top-left
        { x: baseX + labelOffset * 0.7, y: baseY - labelOffset * 0.7, anchor: "start", priority: 6, bounds: { width: textWidth, height: 12 } }, // top-right
        { x: baseX - labelOffset * 0.7, y: baseY + labelOffset * 0.9, anchor: "end", priority: 7, bounds: { width: textWidth, height: 12 } }, // bottom-left
        { x: baseX + labelOffset * 0.7, y: baseY + labelOffset * 0.9, anchor: "start", priority: 8, bounds: { width: textWidth, height: 12 } }, // bottom-right
      ];
      
      // Check each position for conflicts
      for (const position of positions) {
        let hasConflict = false;
        
        // Check against chart bounds
        const labelLeft = position.anchor === "end" ? position.x - position.bounds.width : 
                          position.anchor === "middle" ? position.x - position.bounds.width / 2 : position.x;
        const labelRight = labelLeft + position.bounds.width;
        const labelTop = position.y - position.bounds.height;
        const labelBottom = position.y + 4;
        
        if (labelLeft < margin.left || labelRight > width - margin.right || 
            labelTop < margin.top || labelBottom > height - margin.bottom) {
          hasConflict = true;
          continue;
        }
        
        // Check against other vendor dots and labels
        for (let i = 0; i < allVendors.length; i++) {
          if (i === index) continue;
          
          const otherVendor = allVendors[i];
          const otherX = xScale(otherVendor.adjustedX);
          const otherY = yScale(otherVendor.adjustedY);
          
          // Check distance to other vendor dots (minimum 25px clearance)
          const distanceToDot = Math.sqrt((position.x - otherX) ** 2 + (position.y - otherY) ** 2);
          if (distanceToDot < 25) {
            hasConflict = true;
            break;
          }
          
          // Check overlap with estimated other label positions
          const otherTextWidth = otherVendor.name.length * 7;
          const possibleOtherPositions = [
            { x: otherX, y: otherY - labelOffset, w: otherTextWidth }, // top
            { x: otherX, y: otherY + labelOffset + 8, w: otherTextWidth }, // bottom
          ];
          
          for (const otherPos of possibleOtherPositions) {
            const otherLeft = otherPos.x - otherPos.w / 2;
            const otherRight = otherPos.x + otherPos.w / 2;
            const otherTop = otherPos.y - 12;
            const otherBottom = otherPos.y + 4;
            
            // Check rectangular overlap
            if (!(labelRight < otherLeft || labelLeft > otherRight || 
                  labelBottom < otherTop || labelTop > otherBottom)) {
              hasConflict = true;
              break;
            }
          }
          
          if (hasConflict) break;
        }
        
        if (!hasConflict) {
          return position;
        }
      }
      
      // If no conflict-free position found, use top position with background
      return { ...positions[0], background: true };
    };

    // Add vendor labels with enhanced positioning and readability
    adjustedVendors.forEach((vendor, index) => {
      const labelPos = calculateLabelPosition(vendor, index, adjustedVendors);
      
      const labelGroup = vendorGroups.filter((d, i) => i === index);
      
      // Add background rectangle for better readability when needed
      if (labelPos.background) {
        const textWidth = vendor.name.length * 7.5;
        labelGroup.append("rect")
          .attr("class", "label-background")
          .attr("x", labelPos.anchor === "middle" ? labelPos.x - textWidth/2 - 3 : 
                     labelPos.anchor === "end" ? labelPos.x - textWidth - 3 : labelPos.x - 3)
          .attr("y", labelPos.y - 11)
          .attr("width", textWidth + 6)
          .attr("height", 16)
          .attr("fill", "rgba(255, 255, 255, 0.9)")
          .attr("stroke", "rgba(100, 116, 139, 0.2)")
          .attr("stroke-width", 1)
          .attr("rx", 3)
          .attr("ry", 3)
          .style("pointer-events", "none");
      }
      
      // Add the text label
      labelGroup.append("text")
        .attr("class", "vendor-label")
        .attr("x", labelPos.x)
        .attr("y", labelPos.y)
        .attr("text-anchor", labelPos.anchor)
        .attr("fill", "#1f2937")
        .attr("font-size", "11px")
        .attr("font-weight", "600")
        .style("pointer-events", "none")
        .style("text-shadow", labelPos.background ? "none" : "0 0 6px white, 0 0 6px white, 0 0 6px white")
        .text(vendor.name);
    });

  }, [vendorsWithScores, criteriaWeights]);

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
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>{marketName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <svg ref={svgRef} className="border-2 border-gray-200 rounded-xl bg-white shadow-sm" />
                <div className="mt-4 px-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Historical View - {formatDate(selectedDate)} 
                    {weeksAgo > 0 ? ` (${weeksAgo} ${weeksAgo === 1 ? 'week' : 'weeks'} ago)` : ' (Current)'}
                  </label>
                  <Slider
                    value={timelineValue}
                    onValueChange={setTimelineValue}
                    max={156}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{formatDate(startDate)}</span>
                    <span>{formatDate(today)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Criteria Weights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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

      <Dialog open={!!selectedVendor} onOpenChange={() => setSelectedVendor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedVendor?.vendor.name}</DialogTitle>
          </DialogHeader>
          
          {selectedVendor && (
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
                
                <div className="mt-4">
                  <h4 className="font-medium text-gray-900 mb-2">Individual Scores</h4>
                  <div className="space-y-2 text-sm">
                    {Object.entries(selectedVendor.vendor.scores).map(([criteriaId, score]) => {
                      if (criteriaId === 'product-capabilities') {
                        return (
                          <div key={criteriaId} className="flex justify-between">
                            <span className="text-gray-600">Product Capabilities:</span>
                            <span className="font-medium text-green-600">
                              {score.toFixed(1)}/10
                            </span>
                          </div>
                        );
                      }
                      
                      const criterion = criteria?.find(c => c.id === criteriaId);
                      if (!criterion) return null;
                      
                      return (
                        <div key={criteriaId} className="flex justify-between">
                          <span className="text-gray-600">{criterion.name}:</span>
                          <span className="font-medium">
                            {score.toFixed(1)}/10
                          </span>
                        </div>
                      );
                    })}
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
