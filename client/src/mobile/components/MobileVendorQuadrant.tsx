import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface VendorWithScores {
  id: string;
  name: string;
  executionScore: number;
  viabilityScore: number;
}

interface MobileVendorQuadrantProps {
  vendors: VendorWithScores[];
  onVendorClick?: (vendor: VendorWithScores) => void;
}

export function MobileVendorQuadrant({ vendors, onVendorClick }: MobileVendorQuadrantProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || vendors.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const containerWidth = containerRef.current.offsetWidth;
    const width = containerWidth;
    const height = Math.min(containerWidth, 400);
    const margin = { top: 20, right: 20, bottom: 50, left: 50 };

    svg.attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    const midX = xScale(50);
    const midY = yScale(50);

    // Add quadrant backgrounds with colors
    const quadrants = [
      { x: margin.left, y: margin.top, width: midX - margin.left, height: midY - margin.top, fill: "#dbeafe", label: "Challengers" },
      { x: midX, y: margin.top, width: width - margin.right - midX, height: midY - margin.top, fill: "#d1fae5", label: "Leaders" },
      { x: margin.left, y: midY, width: midX - margin.left, height: height - margin.bottom - midY, fill: "#fef3c7", label: "Emerging" },
      { x: midX, y: midY, width: width - margin.right - midX, height: height - margin.bottom - midY, fill: "#ede9fe", label: "Innovators" }
    ];

    quadrants.forEach((q, i) => {
      svg.append("rect")
        .attr("x", q.x)
        .attr("y", q.y)
        .attr("width", q.width)
        .attr("height", q.height)
        .attr("fill", q.fill)
        .attr("opacity", 0.4);
    });

    // Add center lines
    svg.append("line")
      .attr("x1", midX)
      .attr("x2", midX)
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5");

    svg.append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", midY)
      .attr("y2", midY)
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5");

    // Add axes
    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .style("font-size", "10px");

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(yScale).ticks(5))
      .style("font-size", "10px");

    // Add axis labels
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 5)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("font-weight", "600")
      .style("fill", "#475569")
      .text("Execution →");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(height / 2))
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("font-weight", "600")
      .style("fill", "#475569")
      .text("Viability →");

    // Add vendor dots
    const dots = svg.selectAll(".vendor-dot")
      .data(vendors)
      .enter()
      .append("g")
      .attr("class", "vendor-dot")
      .style("cursor", onVendorClick ? "pointer" : "default");

    dots.append("circle")
      .attr("cx", d => xScale(d.executionScore))
      .attr("cy", d => yScale(d.viabilityScore))
      .attr("r", 6)
      .attr("fill", "#2563eb")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .on("click", (event, d) => {
        if (onVendorClick) {
          onVendorClick(d);
        }
      });

    // Add vendor labels with smart positioning
    dots.append("text")
      .attr("x", d => xScale(d.executionScore))
      .attr("y", d => yScale(d.viabilityScore) - 12)
      .attr("text-anchor", "middle")
      .style("font-size", "9px")
      .style("font-weight", "500")
      .style("fill", "#1e293b")
      .style("pointer-events", "none")
      .text(d => {
        // Truncate long names for mobile
        return d.name.length > 15 ? d.name.substring(0, 12) + "..." : d.name;
      });

  }, [vendors, onVendorClick]);

  return (
    <div ref={containerRef} className="w-full" data-testid="mobile-vendor-quadrant">
      <svg ref={svgRef}></svg>
    </div>
  );
}
