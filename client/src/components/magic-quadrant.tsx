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

  // Initialize weights when data loads
  useEffect(() => {
    if (weights && criteria) {
      const initialWeights: { [id: string]: number } = {};
      criteria.forEach(c => {
        const weight = weights.find(w => w.criteriaId === c.id);
        initialWeights[c.id] = weight?.weight || 25;
      });
      setCriteriaWeights(initialWeights);
    }
  }, [weights, criteria]);

  // Calculate vendor positions
  const vendorsWithScores: VendorWithScores[] = (vendors || []).map(vendor => {
    const vendorScores: { [criteriaId: string]: number } = {};
    let executionTotal = 0;
    let viabilityTotal = 0;
    let executionWeight = 0;
    let viabilityWeight = 0;

    if (scores && criteria) {
      scores.forEach(score => {
        if (score.vendorId === vendor.id) {
          vendorScores[score.criteriaId] = score.score;
          
          const weight = criteriaWeights[score.criteriaId] || 25;
          if (score.criteria.category === "execution") {
            executionTotal += score.score * weight;
            executionWeight += weight;
          } else if (score.criteria.category === "viability") {
            viabilityTotal += score.score * weight;
            viabilityWeight += weight;
          }
        }
      });
    }

    return {
      ...vendor,
      scores: vendorScores,
      executionScore: executionWeight > 0 ? executionTotal / executionWeight : 50,
      viabilityScore: viabilityWeight > 0 ? viabilityTotal / viabilityWeight : 50,
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

    // Add quadrant backgrounds
    const quadrantWidth = (width - margin.left - margin.right) / 2;
    const quadrantHeight = (height - margin.top - margin.bottom) / 2;

    // Niche Players (bottom left)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top + quadrantHeight)
      .attr("width", quadrantWidth)
      .attr("height", quadrantHeight)
      .attr("fill", "#f8fafc")
      .attr("stroke", "#e2e8f0");

    // Leaders (top right)  
    svg.append("rect")
      .attr("x", margin.left + quadrantWidth)
      .attr("y", margin.top)
      .attr("width", quadrantWidth)
      .attr("height", quadrantHeight)
      .attr("fill", "#eff6ff")
      .attr("stroke", "#e2e8f0");

    // Challengers (bottom right)
    svg.append("rect")
      .attr("x", margin.left + quadrantWidth)
      .attr("y", margin.top + quadrantHeight)
      .attr("width", quadrantWidth)
      .attr("height", quadrantHeight)
      .attr("fill", "#fef3c7")
      .attr("stroke", "#e2e8f0");

    // Visionaries (top left)
    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", quadrantWidth)
      .attr("height", quadrantHeight)
      .attr("fill", "#d1fae5")
      .attr("stroke", "#e2e8f0");

    // Add axes
    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(xAxis);

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis);

    // Add axis labels
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-medium fill-gray-700")
      .text("Product Strategy and Execution");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "text-sm font-medium fill-gray-700")
      .text("Vendor Viability");

    // Add quadrant labels
    svg.append("text")
      .attr("x", margin.left + quadrantWidth * 0.5)
      .attr("y", margin.top + 20)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-gray-500")
      .text("Visionaries");

    svg.append("text")
      .attr("x", margin.left + quadrantWidth * 1.5)
      .attr("y", margin.top + 20)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-gray-500")
      .text("Leaders");

    svg.append("text")
      .attr("x", margin.left + quadrantWidth * 0.5)
      .attr("y", margin.top + quadrantHeight + 30)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-gray-500")
      .text("Niche Players");

    svg.append("text")
      .attr("x", margin.left + quadrantWidth * 1.5)
      .attr("y", margin.top + quadrantHeight + 30)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-gray-500")
      .text("Challengers");

    // Add vendor dots
    svg.selectAll(".vendor-dot")
      .data(vendorsWithScores)
      .enter()
      .append("circle")
      .attr("class", "vendor-dot")
      .attr("cx", d => xScale(d.executionScore))
      .attr("cy", d => yScale(d.viabilityScore))
      .attr("r", 8)
      .attr("fill", "#3b82f6")
      .attr("stroke", "#1e40af")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        d3.select(this).attr("r", 12);
      })
      .on("mouseout", function(event, d) {
        d3.select(this).attr("r", 8);
      })
      .on("click", function(event, d) {
        setSelectedVendor({
          vendor: d,
          position: { x: d.executionScore, y: d.viabilityScore }
        });
      });

    // Add vendor labels
    svg.selectAll(".vendor-label")
      .data(vendorsWithScores)
      .enter()
      .append("text")
      .attr("class", "vendor-label")
      .attr("x", d => xScale(d.executionScore))
      .attr("y", d => yScale(d.viabilityScore) - 15)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-gray-700")
      .text(d => d.name);

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
                <svg ref={svgRef} className="border border-gray-300 rounded-lg bg-white" />
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
                      value={[criteriaWeights[criterion.id] || 25]}
                      onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-500 text-right">
                      {criteriaWeights[criterion.id] || 25}%
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
                      value={[criteriaWeights[criterion.id] || 25]}
                      onValueChange={([value]) => handleWeightChange(criterion.id, value)}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-500 text-right">
                      {criteriaWeights[criterion.id] || 25}%
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
