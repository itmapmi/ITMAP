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

export default function MagicQuadrant({ marketId }: MagicQuadrantProps) {
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
      .attr("stop-opacity", 0.15);
    emergingGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#f59e0b")
      .attr("stop-opacity", 0.25);

    // Leaders gradient
    const leadersGradient = defs.append("linearGradient")
      .attr("id", "leadersGradient")
      .attr("gradientUnits", "objectBoundingBox");
    leadersGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#22c55e")
      .attr("stop-opacity", 0.15);
    leadersGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#16a34a")
      .attr("stop-opacity", 0.25);

    // Challengers gradient
    const challengersGradient = defs.append("linearGradient")
      .attr("id", "challengersGradient")
      .attr("gradientUnits", "objectBoundingBox");
    challengersGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#3b82f6")
      .attr("stop-opacity", 0.08);
    challengersGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#1d4ed8")
      .attr("stop-opacity", 0.12);
    
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

    // Add elegant quadrant labels with background boxes
    // Emerging Players label (bottom-left)
    const emergingLabelG = svg.append("g");
    emergingLabelG.append("rect")
      .attr("x", xScale(15) - 45)
      .attr("y", yScale(15) - 10)
      .attr("width", 90)
      .attr("height", 20)
      .attr("fill", "#fbbf24")
      .attr("fill-opacity", 0.9)
      .attr("rx", 10)
      .attr("stroke", "#f59e0b")
      .attr("stroke-width", 1);
    emergingLabelG.append("text")
      .attr("x", xScale(15))
      .attr("y", yScale(15) + 4)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "white")
      .text("Emerging Players");

    // Leaders label (top-right)
    const leadersLabelG = svg.append("g");
    leadersLabelG.append("rect")
      .attr("x", xScale(85) - 25)
      .attr("y", margin.top + 5)
      .attr("width", 50)
      .attr("height", 20)
      .attr("fill", "#22c55e")
      .attr("fill-opacity", 0.9)
      .attr("rx", 10)
      .attr("stroke", "#16a34a")
      .attr("stroke-width", 1);
    leadersLabelG.append("text")
      .attr("x", xScale(85))
      .attr("y", margin.top + 19)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "white")
      .text("Leaders");

    // Challengers label (positioned in top-left of challengers area to avoid vendor dots)
    const challengersLabelG = svg.append("g");
    challengersLabelG.append("rect")
      .attr("x", xScale(35) - 35)
      .attr("y", yScale(85) - 10)
      .attr("width", 70)
      .attr("height", 20)
      .attr("fill", "#3b82f6")
      .attr("fill-opacity", 0.95)
      .attr("rx", 10)
      .attr("stroke", "#1d4ed8")
      .attr("stroke-width", 1);
    challengersLabelG.append("text")
      .attr("x", xScale(35))
      .attr("y", yScale(85) + 4)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-bold")
      .attr("fill", "white")
      .text("Challengers");

    // Function to apply collision detection and spacing
    const applyCollisionDetection = (vendors: VendorWithScores[]): Array<VendorWithScores & { adjustedX: number, adjustedY: number }> => {
      const minDistance = 25; // Minimum distance between dots
      const vendorsWithPositions = vendors.map(vendor => ({
        ...vendor,
        adjustedX: vendor.executionScore,
        adjustedY: vendor.viabilityScore,
      }));

      // Simple collision detection - spread overlapping vendors
      for (let i = 0; i < vendorsWithPositions.length; i++) {
        for (let j = i + 1; j < vendorsWithPositions.length; j++) {
          const v1 = vendorsWithPositions[i];
          const v2 = vendorsWithPositions[j];
          
          const dx = xScale(v1.adjustedX) - xScale(v2.adjustedX);
          const dy = yScale(v1.adjustedY) - yScale(v2.adjustedY);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < minDistance) {
            const angle = Math.atan2(dy, dx);
            const targetDistance = minDistance;
            const offsetX = Math.cos(angle) * (targetDistance - distance) / 2;
            const offsetY = Math.sin(angle) * (targetDistance - distance) / 2;
            
            // Convert back to data coordinates
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

    vendorGroups.append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.adjustedX))
      .attr("cy", d => yScale(d.adjustedY))
      .attr("r", 8)
      .attr("fill", "#6366f1")
      .attr("stroke", "#4338ca")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .style("filter", "drop-shadow(0 2px 4px rgba(99, 102, 241, 0.3))")
      .on("mouseover", function(event, d) {
        d3.select(this).attr("r", 12);
      })
      .on("mouseout", function(event, d) {
        d3.select(this).attr("r", 8);
      })
      .on("click", function(event, d) {
        setSelectedVendor({
          vendor: d,
          position: { x: d.adjustedX, y: d.adjustedY }
        });
      });

    // Function to calculate optimal label position to avoid overlaps
    const calculateLabelPosition = (vendor: typeof adjustedVendors[0], index: number, allVendors: typeof adjustedVendors): { x: number, y: number, anchor: string } => {
      const baseX = xScale(vendor.adjustedX);
      const baseY = yScale(vendor.adjustedY);
      const labelOffset = 16;
      
      // Possible positions around the dot (clockwise from top)
      const positions = [
        { x: baseX, y: baseY - labelOffset, anchor: "middle", priority: 1 }, // top
        { x: baseX + labelOffset * 0.8, y: baseY - labelOffset * 0.6, anchor: "start", priority: 2 }, // top-right
        { x: baseX + labelOffset, y: baseY, anchor: "start", priority: 3 }, // right
        { x: baseX + labelOffset * 0.8, y: baseY + labelOffset * 0.8, anchor: "start", priority: 4 }, // bottom-right
        { x: baseX, y: baseY + labelOffset + 4, anchor: "middle", priority: 5 }, // bottom
        { x: baseX - labelOffset * 0.8, y: baseY + labelOffset * 0.8, anchor: "end", priority: 6 }, // bottom-left
        { x: baseX - labelOffset, y: baseY, anchor: "end", priority: 7 }, // left
        { x: baseX - labelOffset * 0.8, y: baseY - labelOffset * 0.6, anchor: "end", priority: 8 }, // top-left
      ];
      
      // Check each position for conflicts with other labels
      for (const position of positions) {
        let hasConflict = false;
        
        // Check against all other vendors
        for (let i = 0; i < allVendors.length; i++) {
          if (i === index) continue;
          
          const otherVendor = allVendors[i];
          const otherX = xScale(otherVendor.adjustedX);
          const otherY = yScale(otherVendor.adjustedY);
          
          // Check distance to other vendor dots
          const distanceToDot = Math.sqrt((position.x - otherX) ** 2 + (position.y - otherY) ** 2);
          if (distanceToDot < 20) {
            hasConflict = true;
            break;
          }
          
          // Estimate other vendor's label position (assume it uses top position for this check)
          const otherLabelX = otherX;
          const otherLabelY = otherY - labelOffset;
          const distanceToLabel = Math.sqrt((position.x - otherLabelX) ** 2 + (position.y - otherLabelY) ** 2);
          if (distanceToLabel < 25) {
            hasConflict = true;
            break;
          }
        }
        
        if (!hasConflict) {
          return position;
        }
      }
      
      // If no conflict-free position found, use top position as fallback
      return positions[0];
    };

    // Add vendor labels with intelligent positioning
    adjustedVendors.forEach((vendor, index) => {
      const labelPos = calculateLabelPosition(vendor, index, adjustedVendors);
      
      vendorGroups.filter((d, i) => i === index)
        .append("text")
        .attr("class", "vendor-label")
        .attr("x", labelPos.x)
        .attr("y", labelPos.y)
        .attr("text-anchor", labelPos.anchor)
        .attr("fill", "#374151")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .style("pointer-events", "none")
        .style("text-shadow", "0 0 4px white, 0 0 4px white, 0 0 4px white, 0 0 4px white")
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
              <CardTitle>Magic Quadrant</CardTitle>
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
