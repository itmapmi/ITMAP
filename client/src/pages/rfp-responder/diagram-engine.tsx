import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Network, Layers3, HardDrive, Database, Globe, Server, GitBranch,
  Cloud, Shield, ArrowRight, LayoutGrid, Plus, Trash2, Download,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, RotateCcw, Loader2,
  FileImage, FileText, Code2, Info,
} from "lucide-react";
import type { RfpResponseReq } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

const DIAGRAM_INTENTS = [
  "spine-leaf", "three-tier", "SAN", "NAS", "WAN", "HCI", "multi-site-DR",
  "cloud-landing-zone", "security-zoning", "data-pipeline", "app-tier",
] as const;

type DiagramIntent = typeof DIAGRAM_INTENTS[number];

interface IconManifestItem {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  iconTier: 1 | 2 | 3 | 4;
  tierLabel: string;
  tier4Pending: boolean;
}

interface RfpDiagram {
  id: string;
  sessionId: string;
  reqId: string | null;
  diagramIntent: string;
  title: string;
  svgContent: string;
  nodePositions: Record<string, { x: number; y: number }>;
  iconManifest: IconManifestItem[];
  hasTier4Pending: boolean;
  createdAt: string;
}

interface DiagramEngineProps {
  sessionId: string;
  session: {
    vendorId: string;
    marketId: string | null;
    clientOrgName: string | null;
  };
  requirements: RfpResponseReq[];
}

// ── Intent Metadata ───────────────────────────────────────────────────────────

const INTENT_META: Record<DiagramIntent, { name: string; desc: string; Icon: React.FC<{ className?: string }> }> = {
  "spine-leaf": { name: "Spine-Leaf", desc: "Full-mesh data center fabric", Icon: Network },
  "three-tier": { name: "Three-Tier", desc: "Core → aggregation → access", Icon: Layers3 },
  "SAN": { name: "SAN Fabric", desc: "Dual-fabric storage area network", Icon: HardDrive },
  "NAS": { name: "NAS Architecture", desc: "IP-attached file storage", Icon: Database },
  "WAN": { name: "WAN Topology", desc: "Multi-site WAN with firewalls", Icon: Globe },
  "HCI": { name: "HCI Cluster", desc: "Hyper-converged infrastructure", Icon: Server },
  "multi-site-DR": { name: "Multi-Site DR", desc: "Primary + DR site replication", Icon: GitBranch },
  "cloud-landing-zone": { name: "Cloud Landing Zone", desc: "VPC + AZ + subnet layout", Icon: Cloud },
  "security-zoning": { name: "Security Zones", desc: "DMZ, trusted, and untrusted zones", Icon: Shield },
  "data-pipeline": { name: "Data Pipeline", desc: "Sequential processing stages", Icon: ArrowRight },
  "app-tier": { name: "App Tiers", desc: "Presentation, logic, data stack", Icon: LayoutGrid },
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function DiagramEngine({ sessionId, session, requirements }: DiagramEngineProps) {
  const { toast } = useToast();

  // Navigation state
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<DiagramIntent | null>(null);
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);

  // Viewer: pan + zoom
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // Viewer: node nudge
  const draggingNode = useRef<{
    id: string;
    startClient: { x: number; y: number };
    startSvg: { x: number; y: number };
  } | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Reset viewer state when diagram changes
  useEffect(() => {
    setZoom(0.85);
    setPan({ x: 0, y: 0 });
    setLocalPositions({});
    setIsDirty(false);
    draggingNode.current = null;
  }, [selectedDiagramId]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: diagrams = [], isLoading } = useQuery<RfpDiagram[]>({
    queryKey: ["/api/rfp/sessions", sessionId, "diagrams"],
    queryFn: async () => {
      const res = await fetch(`/api/rfp/sessions/${sessionId}/diagrams`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load diagrams");
      return res.json();
    },
  });

  const selectedDiagram = useMemo(
    () => diagrams.find((d) => d.id === selectedDiagramId) ?? null,
    [diagrams, selectedDiagramId],
  );

  // Merged positions for drag-handle overlay
  const mergedPositions = useMemo(
    () => ({ ...selectedDiagram?.nodePositions, ...localPositions }),
    [selectedDiagram?.nodePositions, localPositions],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (body: { intent: string; reqId?: string | null }) =>
      apiRequest(`/api/rfp/sessions/${sessionId}/diagrams/generate`, "POST", body) as Promise<RfpDiagram>,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/rfp/sessions", sessionId, "diagrams"] });
      setShowGenDialog(false);
      setSelectedIntent(null);
      setSelectedReqId(null);
      setSelectedDiagramId(data.id);
      toast({ title: "Diagram generated", description: data.title });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: String(err), variant: "destructive" });
    },
  });

  const nudgeMutation = useMutation({
    mutationFn: (positions: Record<string, { x: number; y: number }>) =>
      apiRequest(`/api/rfp/diagrams/${selectedDiagramId}/node-positions`, "PATCH", positions) as Promise<RfpDiagram>,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/rfp/sessions", sessionId, "diagrams"] });
      setLocalPositions({});
      setIsDirty(false);
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not update node positions", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/rfp/diagrams/${id}`, "DELETE") as Promise<void>,
    onSuccess: async (_, id) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/rfp/sessions", sessionId, "diagrams"] });
      if (selectedDiagramId === id) setSelectedDiagramId(null);
      toast({ title: "Diagram deleted" });
    },
  });

  // ── Pan + Zoom ────────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(Math.max(z * factor, 0.18), 3));
  }, []);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-drag-handle]")) return;
    isPanning.current = true;
    lastPanPos.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning.current) {
      setPan({ x: e.clientX - lastPanPos.current.x, y: e.clientY - lastPanPos.current.y });
    }
  }, []);

  const handleCanvasPointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // ── Node nudge handlers ───────────────────────────────────────────────────

  const handleNodePointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    nodeId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const currentPos = { ...selectedDiagram?.nodePositions, ...localPositions }[nodeId] ?? { x: 0, y: 0 };
    draggingNode.current = {
      id: nodeId,
      startClient: { x: e.clientX, y: e.clientY },
      startSvg: { ...currentPos },
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [selectedDiagram?.nodePositions, localPositions]);

  const handleNodePointerMove = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    nodeId: string,
  ) => {
    if (!draggingNode.current || draggingNode.current.id !== nodeId) return;
    const dx = (e.clientX - draggingNode.current.startClient.x) / zoom;
    const dy = (e.clientY - draggingNode.current.startClient.y) / zoom;
    setLocalPositions((prev) => ({
      ...prev,
      [nodeId]: {
        x: draggingNode.current!.startSvg.x + dx,
        y: draggingNode.current!.startSvg.y + dy,
      },
    }));
    setIsDirty(true);
  }, [zoom]);

  const handleNodePointerUp = useCallback(() => {
    draggingNode.current = null;
  }, []);

  const handleSavePositions = useCallback(() => {
    if (!selectedDiagram || !isDirty) return;
    const merged = { ...selectedDiagram.nodePositions, ...localPositions };
    nudgeMutation.mutate(merged);
  }, [selectedDiagram, isDirty, localPositions, nudgeMutation]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback((fmt: "png" | "pdf" | "drawio") => {
    if (!selectedDiagramId) return;
    window.open(`/api/rfp/diagrams/${selectedDiagramId}/export?format=${fmt}`, "_blank");
  }, [selectedDiagramId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  // Viewer
  if (selectedDiagram) {
    const manifest = selectedDiagram.iconManifest ?? [];
    return (
      <div className="flex flex-col gap-4">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white gap-1.5"
              onClick={() => setSelectedDiagramId(null)}
            >
              <ChevronLeft className="h-4 w-4" /> All Diagrams
            </Button>
            <span className="text-slate-700">|</span>
            <span className="text-white font-medium text-sm">{selectedDiagram.title}</span>
            <Badge className="text-[10px] bg-cyan-500/10 text-cyan-400 border-cyan-500/20 border">
              {selectedDiagram.diagramIntent}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs"
                onClick={handleSavePositions}
                disabled={nudgeMutation.isPending}
              >
                {nudgeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Save Positions
              </Button>
            )}
            {!selectedDiagram.hasTier4Pending && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-white/10 text-slate-400 hover:text-white text-xs"
                  onClick={() => handleExport("png")}
                >
                  <FileImage className="h-3.5 w-3.5" /> PNG
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-white/10 text-slate-400 hover:text-white text-xs"
                  onClick={() => handleExport("pdf")}
                >
                  <FileText className="h-3.5 w-3.5" /> PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-white/10 text-slate-400 hover:text-white text-xs"
                  onClick={() => handleExport("drawio")}
                >
                  <Code2 className="h-3.5 w-3.5" /> draw.io
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-red-400 hover:bg-red-500/10 text-xs"
              onClick={() => {
                if (confirm("Delete this diagram?")) deleteMutation.mutate(selectedDiagram.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Tier 4 warning */}
        {selectedDiagram.hasTier4Pending && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3">
            <Info className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-300">
              This diagram contains unreviewed Tier 4 icon assets. Export is blocked until icons are reviewed.
            </p>
          </div>
        )}

        {/* Viewer + manifest */}
        <div className="flex gap-4" style={{ height: "560px" }}>
          {/* SVG panel */}
          <div className="flex-1 relative flex flex-col rounded-xl overflow-hidden border border-white/5 bg-[#0c1222]">
            {/* Zoom controls */}
            <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                onClick={() => setZoom((z) => Math.min(z * 1.2, 3))}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                onClick={() => setZoom((z) => Math.max(z * 0.8, 0.18))}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                onClick={() => { setZoom(0.85); setPan({ x: 0, y: 0 }); }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Hint */}
            <div className="absolute bottom-3 left-3 z-20 text-[10px] text-slate-600 select-none">
              Scroll to zoom · Drag background to pan · Drag nodes to nudge
            </div>

            {/* Canvas */}
            <div
              ref={svgContainerRef}
              className="flex-1 relative overflow-hidden"
              style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
              onWheel={handleWheel}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
            >
              {/* SVG */}
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "0 0",
                  width: "1200px",
                  height: "750px",
                  pointerEvents: "none",
                }}
                dangerouslySetInnerHTML={{ __html: selectedDiagram.svgContent }}
              />

              {/* Drag handles (one per node) */}
              {Object.entries(mergedPositions).map(([nodeId, pos]) => {
                const nodeInfo = manifest.find((m) => m.nodeId === nodeId);
                return (
                  <div
                    key={nodeId}
                    data-drag-handle="true"
                    title={nodeInfo?.nodeLabel}
                    style={{
                      position: "absolute",
                      left: `${pos.x * zoom + pan.x - 26 * zoom}px`,
                      top: `${pos.y * zoom + pan.y - 26 * zoom}px`,
                      width: `${52 * zoom}px`,
                      height: `${52 * zoom}px`,
                      cursor: "grab",
                      borderRadius: "8px",
                      zIndex: 10,
                    }}
                    onPointerDown={(e) => handleNodePointerDown(e, nodeId)}
                    onPointerMove={(e) => handleNodePointerMove(e, nodeId)}
                    onPointerUp={handleNodePointerUp}
                  />
                );
              })}
            </div>
          </div>

          {/* Manifest sidebar */}
          <div className="w-56 flex flex-col rounded-xl border border-white/5 bg-slate-900 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-white/5">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Icon Manifest</p>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {manifest.length === 0 && (
                <p className="text-xs text-slate-600 text-center py-4">No nodes</p>
              )}
              {manifest.map((item) => (
                <div key={item.nodeId} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/3 group">
                  <div
                    className="mt-0.5 flex-shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ background: tierColor(item.iconTier) }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 truncate leading-tight">{item.nodeLabel}</p>
                    <p className="text-[10px] text-slate-600 truncate">{item.nodeType}</p>
                    <p className="text-[9px] text-slate-700 mt-0.5">{item.tierLabel}</p>
                  </div>
                  {item.tier4Pending && (
                    <span className="text-[9px] text-amber-400 bg-amber-500/10 rounded px-1">Pending</span>
                  )}
                </div>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-white/5">
              <p className="text-[9px] text-slate-700 leading-relaxed">
                Tier 3 = generic SVG · Tier 2 = vendor · Tier 1 = official
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Architecture Diagrams</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            AI-generated topology diagrams illustrating vendor architecture for this RFP.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white text-xs"
          onClick={() => setShowGenDialog(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Add Diagram
        </Button>
      </div>

      {/* Empty state */}
      {diagrams.length === 0 && (
        <div className="rounded-xl border border-white/5 bg-slate-900/50 px-8 py-12 text-center">
          <Network className="h-10 w-10 text-cyan-500/40 mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-medium mb-1">No diagrams yet</p>
          <p className="text-xs text-slate-600 mb-4">
            Generate an AI architecture diagram to illustrate how this vendor meets the RFP's technical requirements.
          </p>
          <Button
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-xs"
            onClick={() => setShowGenDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Generate First Diagram
          </Button>
        </div>
      )}

      {/* Diagram cards */}
      {diagrams.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {diagrams.map((d) => {
            const meta = INTENT_META[d.diagramIntent as DiagramIntent];
            const Icon = meta?.Icon ?? Network;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedDiagramId(d.id)}
                className="text-left rounded-xl border border-white/5 bg-slate-900 hover:bg-slate-800/80 hover:border-white/10 p-4 transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-cyan-500/10 p-2">
                      <Icon className="h-4 w-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white leading-tight">{d.title}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{meta?.name ?? d.diagramIntent}</p>
                    </div>
                  </div>
                  {d.hasTier4Pending && (
                    <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 border flex-shrink-0">
                      Tier 4
                    </Badge>
                  )}
                </div>
                {/* SVG thumbnail */}
                <div
                  className="rounded-lg overflow-hidden border border-white/5 bg-[#0c1222]"
                  style={{ height: "140px" }}
                >
                  <div
                    style={{
                      transform: "scale(0.24)",
                      transformOrigin: "0 0",
                      width: "1200px",
                      height: "750px",
                      pointerEvents: "none",
                    }}
                    dangerouslySetInnerHTML={{ __html: d.svgContent }}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <p className="text-[10px] text-slate-600">
                    {new Date(d.createdAt).toLocaleDateString()} · {d.iconManifest?.length ?? 0} nodes
                  </p>
                  <span className="text-[10px] text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    View →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Generate dialog */}
      <Dialog open={showGenDialog} onOpenChange={setShowGenDialog}>
        <DialogContent className="sm:max-w-2xl bg-slate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Generate Architecture Diagram</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Choose a diagram type and optionally link it to a specific RFP requirement.
            </DialogDescription>
          </DialogHeader>

          {/* Intent grid */}
          <div className="grid grid-cols-3 gap-2 mt-1">
            {DIAGRAM_INTENTS.map((intent) => {
              const meta = INTENT_META[intent];
              const Icon = meta.Icon;
              const active = selectedIntent === intent;
              return (
                <button
                  key={intent}
                  onClick={() => setSelectedIntent(intent)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    active
                      ? "border-cyan-500/50 bg-cyan-500/10"
                      : "border-white/5 bg-slate-800/50 hover:border-white/15 hover:bg-slate-800"
                  }`}
                >
                  <Icon className={`h-4 w-4 mb-1.5 ${active ? "text-cyan-400" : "text-slate-400"}`} />
                  <p className={`text-xs font-medium leading-tight ${active ? "text-cyan-300" : "text-slate-300"}`}>
                    {meta.name}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">{meta.desc}</p>
                </button>
              );
            })}
          </div>

          {/* Requirement selector (optional) */}
          {requirements.length > 0 && (
            <div className="mt-2">
              <label className="block text-xs text-slate-500 mb-1.5">
                Link to requirement <span className="text-slate-700">(optional — adds context to the prompt)</span>
              </label>
              <select
                value={selectedReqId ?? ""}
                onChange={(e) => setSelectedReqId(e.target.value || null)}
                className="w-full rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-300 px-3 py-2 focus:outline-none focus:border-cyan-500/50"
              >
                <option value="">None</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requirementText.slice(0, 90)}{r.requirementText.length > 90 ? "…" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              className="text-slate-400"
              onClick={() => { setShowGenDialog(false); setSelectedIntent(null); setSelectedReqId(null); }}
            >
              Cancel
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white gap-2"
              disabled={!selectedIntent || generateMutation.isPending}
              onClick={() => {
                if (!selectedIntent) return;
                generateMutation.mutate({ intent: selectedIntent, reqId: selectedReqId });
              }}
            >
              {generateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {generateMutation.isPending ? "Generating…" : "Generate Diagram"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierColor(tier: number): string {
  if (tier === 1) return "#22d3ee";
  if (tier === 2) return "#34d399";
  if (tier === 3) return "#94a3b8";
  return "#fbbf24";
}
