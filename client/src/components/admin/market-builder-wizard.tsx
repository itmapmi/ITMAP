import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  CheckCircle2, Circle, Loader2, AlertCircle, Wand2, Sparkles, Lock,
  ChevronRight, ChevronLeft, RefreshCw, Trash2, RotateCcw,
  ExternalLink, Eye, EyeOff, Building2, BarChart3, Grid3X3, Layers, Save,
  Plus, X, Globe, PencilLine, PlayCircle, FileSearch, Clock, Zap,
  ArrowRight, MoreHorizontal, FolderOpen, Cpu, ChevronDown,
} from "lucide-react";
import { LLMSelector } from "./market-builder-llm-panel";
import { SourcesPanel } from "./market-builder-sources";
import { PromptSelector } from "./market-builder-prompt-selector";

// ── Types ─────────────────────────────────────────────────────────────────

interface MarketBuilderJob {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "published";
  inputName: string;
  inputDescription: string;
  inputCategory: string | null;
  inputContext: string | null;
  llmProvider: string;
  llmModel: string;
  marketId: string | null;
  error: string | null;
  createdAt: string;
  stages?: MarketBuilderStage[];
  stageSummary?: Record<number, "pending" | "running" | "completed" | "failed">;
}

interface MarketBuilderStage {
  id: string; jobId: string; stage: number;
  status: "pending" | "running" | "completed" | "failed";
  result: any; error: string | null;
}

type StagePhase = "ready" | "running" | "done" | "failed";
type WizardView = "dashboard" | "new-setup" | "stages" | "published";

const STAGE_META = [
  { num: 1, label: "Vendors",             icon: Building2, eta: "~1 min",    desc: "AI identifies key vendors and products in this market.", what: "Top 15 vendors with names, product descriptions, websites, and newsroom URLs — plus a 'Next 10' suggestions list to optionally include." },
  { num: 2, label: "Vendor Scores",       icon: BarChart3,  eta: "3–5 min",  desc: "AI assigns numeric 0–10 scores per vendor × criterion (no commentary yet).", what: "Market-specific criterion weights and a 0–10 numeric score for every vendor × criterion." },
  { num: 3, label: "Vendor Commentary",   icon: BarChart3,  eta: "5–8 min",  desc: "AI writes 100–250 word commentary for each vendor × criterion score.", what: "Evidence-based commentary and source citations for every vendor × criterion combination." },
  { num: 4, label: "Product Features",    icon: Grid3X3,    eta: "~1 min",   desc: "AI defines technical product capability categories and features for this market.", what: "5–8 product capability categories with 5–12 features each (50–80 features total)." },
  { num: 5, label: "Product Scoring",     icon: BarChart3,  eta: "8–12 min", desc: "AI rates each vendor's product capabilities using the Harvey Ball scale (0–4) — scores only, no commentary.", what: "Harvey Ball support levels (0–4) for every vendor × product feature." },
  { num: 6, label: "Product Commentary",  icon: BarChart3,  eta: "15–25 min",desc: "AI writes 100–250 word commentary for each vendor × product feature score.", what: "Evidence-based commentary and source citations for every vendor × product feature." },
  { num: 7, label: "Ecosystem",           icon: Layers,     eta: "~1 min",   desc: "AI defines ISV/partner ecosystem integration categories and individual integration points.", what: "4–6 ecosystem categories with 6–10 integration points each (30–45 integrations total)." },
  { num: 8, label: "Ecosystem Scoring",   icon: BarChart3,  eta: "5–8 min",  desc: "AI rates each vendor's ecosystem integrations using the Harvey Ball scale (0–4) — scores only.", what: "Harvey Ball support levels (0–4) for every vendor × ecosystem integration." },
  { num: 9, label: "Ecosystem Commentary",icon: BarChart3,  eta: "8–15 min", desc: "AI writes 100–250 word commentary for each vendor × ecosystem integration score.", what: "Evidence-based commentary and source citations for every vendor × ecosystem integration." },
];

const CATEGORIES = [
  "Infrastructure",
  "Data, Analytics & AI",
  "Cybersecurity",
  "DevOps & Platforms",
  "Business Applications",
  "Collaboration and Productivity",
  "Industrial Applications",
];

// ── Stuck-stage reset helper ───────────────────────────────────────────────
// Shown when a stage is "running" but the activity log is empty (orphaned run).
// After 30 s the user sees an option to reset it back to idle.

function StuckStageReset({ jobId, stageNum, apiBase, onReset }: {
  jobId: string; stageNum: number; apiBase: string; onReset: () => void;
}) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 30_000);
    return () => clearTimeout(t);
  }, []);

  const resetMutation = useMutation({
    mutationFn: () =>
      apiRequest(`${apiBase}/jobs/${jobId}/stages/${stageNum}/reset`, "POST").then(r => r.json()),
    onSuccess: () => {
      toast({ title: `Stage ${stageNum} reset`, description: "You can now re-run this stage." });
      onReset();
    },
    onError: (err: any) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  if (!show) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800">Stage appears stuck</p>
        <p className="text-xs text-amber-700 mt-0.5">
          No activity logged in 30 s — the server may have restarted mid-run.
          Reset this stage so you can run it again.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100"
          disabled={resetMutation.isPending}
          onClick={() => resetMutation.mutate()}
        >
          {resetMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reset Stage {stageNum}
        </Button>
      </div>
    </div>
  );
}

// ── Mini stage progress dots (used in dashboard cards) ────────────────────

function StageDots({ stageSummary }: { stageSummary: Record<number, string> }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5,6,7,8,9].map(n => {
        const s = stageSummary[n];
        return (
          <div key={n} className="flex items-center gap-0.5">
            <div title={`Stage ${n}: ${s ?? "not started"}`} className={`h-2 w-2 rounded-full transition-all ${
              s === "completed" ? "bg-green-500" :
              s === "running"   ? "bg-blue-500 animate-pulse" :
              s === "failed"    ? "bg-red-400" :
                                  "bg-gray-200"
            }`} />
            {n < 9 && <div className={`h-px w-2 ${s === "completed" ? "bg-green-300" : "bg-gray-200"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step tracker (in-wizard top bar) ──────────────────────────────────────

function StepTracker({ activeStage, stagePhases, onStepClick }: {
  activeStage: number;
  stagePhases: Record<number, StagePhase>;
  onStepClick: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-0">
      {STAGE_META.map((s, i) => {
        const phase = stagePhases[s.num];
        const isActive = s.num === activeStage;
        const isDone = phase === "done";
        const isRunning = phase === "running";
        const isLocked = !phase && s.num > activeStage;
        return (
          <div key={s.num} className="flex items-center flex-1 min-w-0">
            <button
              onClick={() => isDone && onStepClick(s.num)}
              title={`${s.label} — est. ${s.eta}`}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg flex-1 min-w-0 text-left transition-all ${
                isActive  ? "bg-blue-50 border-2 border-blue-300" :
                isDone    ? "hover:bg-gray-50 cursor-pointer border border-transparent" :
                            "cursor-default border border-transparent"
              }`}
            >
              <div className="shrink-0">
                {isDone    ? <CheckCircle2 className="h-5 w-5 text-green-600" /> :
                 isRunning ? <Loader2 className="h-5 w-5 text-blue-600 animate-spin" /> :
                 isLocked  ? <Lock className="h-4 w-4 text-gray-300" /> :
                             <Circle className="h-5 w-5 text-blue-400" />}
              </div>
              <div className="min-w-0 hidden sm:block">
                <p className={`text-xs font-semibold truncate ${
                  isActive ? "text-blue-800" : isDone ? "text-gray-700" : "text-gray-400"
                }`}>{s.num}. {s.label}</p>
              </div>
            </button>
            {i < STAGE_META.length - 1 && <ChevronRight className="h-4 w-4 text-gray-200 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage result editors ──────────────────────────────────────────────────

function Stage1Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const vendors = result?.vendors ?? [];
  const nextTen: any[] = result?.nextTenVendors ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const startEdit = (i: number) => { setEditing(i); setDraft({ ...vendors[i] }); };
  const saveEdit = () => {
    onChange({ ...result, vendors: vendors.map((v: any, i: number) => i === editing ? draft : v) });
    setEditing(null); setDraft(null);
  };
  const removeVendor = (i: number) => onChange({ ...result, vendors: vendors.filter((_: any, j: number) => j !== i) });
  const addVendor = () => {
    onChange({ ...result, vendors: [...vendors, { name: "", product: "", website: "", description: "", newsroomUrl: "" }] });
    setEditing(vendors.length); setDraft({ name: "", product: "", website: "", description: "", newsroomUrl: "" });
  };

  const promoteVendor = (nv: any) => {
    const promoted = { name: nv.name, product: nv.product, website: "", description: nv.description, newsroomUrl: "" };
    onChange({
      ...result,
      vendors: [...vendors, promoted],
      nextTenVendors: nextTen.filter((v: any) => v.name !== nv.name),
    });
  };
  const dismissNext = (name: string) => {
    onChange({ ...result, nextTenVendors: nextTen.filter((v: any) => v.name !== name) });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-gray-600">Market Summary</Label>
        <Textarea value={result?.marketSummary ?? ""} onChange={e => onChange({ ...result, marketSummary: e.target.value })} rows={3} className="text-xs resize-none" />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{vendors.length} Vendors</p>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addVendor}><Plus className="h-3.5 w-3.5" />Add Vendor</Button>
      </div>
      {vendors.map((v: any, i: number) => (
        <div key={i} className="rounded-lg border bg-white p-3">
          {editing === i ? (
            <div className="space-y-2">
              {["name","product","website","newsroomUrl"].map(field => (
                <div key={field}><Label className="text-xs capitalize">{field === "newsroomUrl" ? "Newsroom URL" : field}</Label><Input value={draft?.[field] ?? ""} onChange={e => setDraft((d: any) => ({ ...d, [field]: e.target.value }))} className="h-7 text-xs mt-0.5" /></div>
              ))}
              <div><Label className="text-xs">Description</Label><Textarea value={draft?.description ?? ""} onChange={e => setDraft((d: any) => ({ ...d, description: e.target.value }))} rows={2} className="text-xs resize-none mt-0.5" /></div>
              <div className="flex gap-2"><Button size="sm" className="h-7 text-xs" onClick={saveEdit}><Save className="h-3 w-3 mr-1" />Save</Button><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button></div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{v.name} <span className="text-gray-400 font-normal">— {v.product}</span></p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{v.description}</p>
                {v.website && <a href={v.website} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5"><Globe className="h-3 w-3" />{v.website}</a>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(i)}><PencilLine className="h-3.5 w-3.5 text-gray-400" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeVendor(i)}><X className="h-3.5 w-3.5 text-red-400" /></Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {nextTen.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-dashed border-gray-200" />
            <div className="flex items-center gap-1.5 shrink-0">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              <p className="text-sm font-semibold text-gray-700">Next 10 — Suggested Players</p>
            </div>
            <div className="flex-1 border-t border-dashed border-gray-200" />
          </div>
          <p className="text-xs text-gray-500">
            These vendors are notable but not yet in the top tier. Add any that should be included in the full research.
          </p>
          <div className="space-y-2">
            {nextTen.map((nv: any) => (
              <div key={nv.name} className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{nv.name} <span className="text-gray-400 font-normal">— {nv.product}</span></p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{nv.description}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-violet-300 text-violet-700 hover:bg-violet-50"
                    onClick={() => promoteVendor(nv)}
                  >
                    <Plus className="h-3 w-3" />Include
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => dismissNext(nv.name)}>
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const AUTO_COMPUTED_CRITERIA = new Set(["Product Capabilities", "ISV Ecosystem"]);
const AUTO_COMPUTED_LABELS: Record<string, string> = {
  "Product Capabilities": "Auto-computed from Stages 5–6",
  "ISV Ecosystem":        "Auto-computed from Stages 8–9",
};

function Stage2Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const weights: any[] = result?.criteriaWeights ?? [];
  const scores: any[] = result?.scores ?? [];
  const [selected, setSelected] = useState<{ v: string; c: string } | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editCommentary, setEditCommentary] = useState("");
  const [editSources, setEditSources] = useState<string[]>([]);

  const updateWeight = (criterionName: string, weight: number) =>
    onChange({ ...result, criteriaWeights: weights.map((w: any) => w.criterionName === criterionName ? { ...w, weight } : w) });

  const getScore = (v: string, c: string) => scores.find((s: any) => s.vendorName === v && s.criterionName === c);
  const saveScore = () => {
    if (!selected) return;
    onChange({ ...result, scores: scores.map((s: any) => s.vendorName === selected.v && s.criterionName === selected.c ? { ...s, score: parseFloat(editScore) || s.score, commentary: editCommentary, sources: editSources.filter(Boolean) } : s) });
    setSelected(null);
  };

  const vendors = [...new Set<string>(scores.map((s: any) => s.vendorName))];
  const scoreCellColor = (s: number) => s >= 8 ? "bg-green-100 text-green-800" : s >= 6 ? "bg-blue-100 text-blue-800" : s >= 4 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

  return (
    <div className="space-y-5">
      {/* Criteria weights by axis — shows rationale + editable weight */}
      {["execution", "viability"].map(axis => {
        const axisCriteria = weights.filter((w: any) => (w.criterionCategory ?? "").toLowerCase() === axis);
        if (!axisCriteria.length) return null;
        return (
          <div key={axis}>
            <p className="text-sm font-semibold capitalize text-gray-700 mb-2">{axis} Axis — Criteria</p>
            <div className="space-y-2">
              {axisCriteria.map((w: any) => (
                <div key={w.criterionName} className="rounded-lg border bg-white p-3 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <p className="text-xs font-semibold text-gray-800 flex-1">{w.criterionName}</p>
                    <Label className="text-xs text-gray-400 shrink-0">Weight</Label>
                    <Input type="number" min={1} max={100} value={w.weight}
                      onChange={e => updateWeight(w.criterionName, parseInt(e.target.value) || 1)}
                      className="h-7 text-xs w-14 text-center" />
                  </div>
                  {w.scoringRationale && (
                    <p className="text-xs text-gray-500 leading-relaxed border-t pt-1.5">{w.scoringRationale}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Score edit panel */}
      {selected && (() => {
        const wordCount = editCommentary.trim().split(/\s+/).filter(Boolean).length;
        const wColor = wordCount < 100 ? "text-red-500" : wordCount > 250 ? "text-orange-500" : "text-green-600";
        return (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.c}</p>
            <div className="flex gap-2">
              <div className="w-24 shrink-0"><Label className="text-xs">Score (0–10)</Label>
                <Input type="number" min={0} max={10} step={0.1} value={editScore} onChange={e => setEditScore(e.target.value)} className="h-7 text-xs text-center mt-0.5" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <Label className="text-xs">Commentary</Label>
                  <span className={`text-xs font-mono ${wColor}`}>{wordCount} words</span>
                </div>
                <Textarea value={editCommentary} onChange={e => setEditCommentary(e.target.value)} rows={5} className="text-xs resize-none" placeholder="100–250 words of evidence-based commentary. No inline references — add sources below." />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Sources <span className="text-gray-400 font-normal">(one per line, no inline refs in commentary)</span></Label>
              <Textarea
                value={editSources.join("\n")}
                onChange={e => setEditSources(e.target.value.split("\n"))}
                rows={3}
                className="text-xs resize-none font-mono"
                placeholder={"Vendor documentation — vendor.com/docs\nReddit r/sysadmin — community feedback\nVendor blog post — vendor.com/blog/announcement"}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={saveScore}><Save className="h-3 w-3 mr-1" />Save</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>Cancel</Button>
            </div>
          </div>
        );
      })()}

      {/* Auto-computed notice */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <strong>Product Capabilities</strong> and <strong>ISV Ecosystem</strong> scores are locked —
          they are automatically computed from Harvey Ball data when the market is published (Stages 3–4 and 5–6 respectively).
        </p>
      </div>

      {/* Score matrix */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Vendor Scores (0–10)</p>
        <div className="overflow-x-auto rounded-lg border text-xs">
          <table className="w-full">
            <thead><tr className="bg-gray-50 border-b">
              <th className="text-left p-2 text-gray-600 w-32">Vendor</th>
              {weights.map((w: any) => (
                <th key={w.criterionName} className={`p-2 text-center whitespace-nowrap max-w-20 truncate ${AUTO_COMPUTED_CRITERIA.has(w.criterionName) ? "text-amber-600" : "text-gray-600"}`}
                    title={AUTO_COMPUTED_CRITERIA.has(w.criterionName) ? AUTO_COMPUTED_LABELS[w.criterionName] : w.criterionName}>
                  {w.criterionName}
                  {AUTO_COMPUTED_CRITERIA.has(w.criterionName) && <Lock className="inline h-2.5 w-2.5 ml-0.5 mb-0.5" />}
                </th>
              ))}
            </tr></thead>
            <tbody>{vendors.map(v => (
              <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2 font-medium whitespace-nowrap">{v}</td>
                {weights.map((w: any) => {
                  const s = getScore(v, w.criterionName);
                  const isLocked = AUTO_COMPUTED_CRITERIA.has(w.criterionName);
                  if (isLocked) {
                    return (
                      <td key={w.criterionName} className="p-1 text-center">
                        <span className="rounded px-2 py-0.5 text-xs font-mono font-semibold bg-amber-50 text-amber-500 border border-amber-200 cursor-default select-none"
                              title={AUTO_COMPUTED_LABELS[w.criterionName]}>auto</span>
                      </td>
                    );
                  }
                  return <td key={w.criterionName} className="p-1 text-center">
                    <button onClick={() => { setSelected({ v, c: w.criterionName }); setEditScore(s?.score?.toString() ?? ""); setEditCommentary(s?.commentary ?? ""); setEditSources(s?.sources ?? []); }}
                      className={`rounded px-2 py-0.5 text-xs font-mono font-semibold hover:ring-2 hover:ring-blue-300 ${scoreCellColor(s?.score ?? 0)}`}
                      title={s?.commentary}>{s?.score?.toFixed(1) ?? "–"}</button>
                  </td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-1">Click any unlocked score cell to edit. Locked cells are auto-computed at publish.</p>
      </div>
    </div>
  );
}

function FeatureCategoryEditor({ result, onChange, addCatLabel = "Add Category" }: { result: any; onChange: (r: any) => void; addCatLabel?: string }) {
  const cats = result?.categories ?? [];
  const updateCat = (i: number, field: string, v: any) =>
    onChange({ ...result, categories: cats.map((c: any, j: number) => j === i ? { ...c, [field]: v } : c) });
  const removeCat = (i: number) => onChange({ ...result, categories: cats.filter((_: any, j: number) => j !== i) });
  const addFeature = (ci: number) => updateCat(ci, "features", [...(cats[ci].features ?? []), { name: "", description: "" }]);
  const updateFeature = (ci: number, fi: number, field: string, v: string) =>
    updateCat(ci, "features", cats[ci].features.map((f: any, j: number) => j === fi ? { ...f, [field]: v } : f));
  const removeFeature = (ci: number, fi: number) =>
    updateCat(ci, "features", cats[ci].features.filter((_: any, j: number) => j !== fi));
  return (
    <div className="space-y-2">
      <Accordion type="multiple" className="space-y-2">
        {cats.map((cat: any, ci: number) => (
          <AccordionItem key={ci} value={`cat-${ci}`} className="border rounded-lg px-3">
            <AccordionTrigger className="text-sm py-3 hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Input value={cat.name} onChange={e => { e.stopPropagation(); updateCat(ci, "name", e.target.value); }} onClick={e => e.stopPropagation()} className="h-7 text-sm flex-1 max-w-xs" />
                <Badge variant="outline" className="text-gray-400 text-xs">{cat.features?.length ?? 0} features</Badge>
                <button onClick={e => { e.stopPropagation(); removeCat(ci); }} className="text-red-400 hover:text-red-600 ml-1"><X className="h-3.5 w-3.5" /></button>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-2">
              <Textarea value={cat.description} onChange={e => updateCat(ci, "description", e.target.value)} rows={2} className="text-xs resize-none" placeholder="Category description…" />
              <div className="flex flex-wrap gap-1.5">
                {(cat.features ?? []).map((f: any, fi: number) => (
                  <div key={fi} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5 group">
                    <Input value={f.name} onChange={e => updateFeature(ci, fi, "name", e.target.value)} className="h-5 text-xs border-0 bg-transparent p-0 w-24 focus-visible:ring-0" />
                    <button onClick={() => removeFeature(ci, fi)} className="opacity-0 group-hover:opacity-100 text-red-400"><X className="h-3 w-3" /></button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-6 text-xs rounded-full px-2" onClick={() => addFeature(ci)}><Plus className="h-3 w-3 mr-0.5" />Add</Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() =>
        onChange({ ...result, categories: [...cats, { name: "New Category", description: "", features: [] }] })}>
        <Plus className="h-3.5 w-3.5 mr-1" />{addCatLabel}
      </Button>
    </div>
  );
}

function Stage3Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const cats = result?.categories ?? [];
  const totalFeatures = cats.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        <Grid3X3 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
        <span><strong>{cats.length}</strong> product categories · <strong>{totalFeatures}</strong> features — these drive the product capability matrix (Support Matrix tab)</span>
      </div>
      <FeatureCategoryEditor result={result} onChange={onChange} addCatLabel="Add Product Category" />
    </div>
  );
}

function HarveyBallGrid({ support, onChange, label }: { support: any[]; onChange: (s: any[]) => void; label?: string }) {
  const vendors = [...new Set<string>(support.map((s: any) => s.vendorName))];
  const features = [...new Set<string>(support.map((s: any) => s.featureName))];
  const [selected, setSelected] = useState<{ v: string; f: string } | null>(null);
  const [editLevel, setEditLevel] = useState(0);
  const [editComments, setEditComments] = useState("");
  const [editSources, setEditSources] = useState<string[]>([]);
  const PAGE_SIZE = 22;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(features.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageFeatures = features.slice(pageStart, pageStart + PAGE_SIZE);
  const HARVEY = ["✕ None", "◔ Limited", "◑ Partial", "◕ Good", "● Full"];
  const lcolor = (l: number) => ["text-gray-300", "text-red-400", "text-yellow-500", "text-blue-500", "text-green-600"][l] ?? "";
  const get = (v: string, f: string) => support.find((s: any) => s.vendorName === v && s.featureName === f);
  const save = () => {
    if (!selected) return;
    onChange(support.map((s: any) => s.vendorName === selected.v && s.featureName === selected.f
      ? { ...s, supportLevel: editLevel, comments: editComments, sources: editSources.filter(Boolean) }
      : s));
    setSelected(null);
  };
  return (
    <div className="space-y-3">
      {label && <p className="text-sm font-semibold text-gray-700">{label}</p>}
      {selected && (() => {
        const wordCount = editComments.trim().split(/\s+/).filter(Boolean).length;
        const wColor = wordCount < 100 ? "text-red-500" : wordCount > 250 ? "text-orange-500" : "text-green-600";
        return (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.f}</p>
            <div className="flex gap-1.5 flex-wrap">{HARVEY.map((h, l) => <button key={l} onClick={() => setEditLevel(l)} className={`text-xs px-2 py-1 rounded border ${editLevel === l ? "border-blue-500 bg-blue-100 font-semibold" : "border-gray-200"}`}>{h}</button>)}</div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <Label className="text-xs">Commentary</Label>
                <span className={`text-xs font-mono ${wColor}`}>{wordCount} words</span>
              </div>
              <Textarea value={editComments} onChange={e => setEditComments(e.target.value)} rows={5} className="text-xs resize-none" placeholder="100–250 words of evidence-based commentary. No inline references — add sources below." />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Sources <span className="text-gray-400 font-normal">(one per line)</span></Label>
              <Textarea
                value={editSources.join("\n")}
                onChange={e => setEditSources(e.target.value.split("\n"))}
                rows={3}
                className="text-xs resize-none font-mono"
                placeholder={"Vendor documentation — vendor.com/docs\nReddit r/sysadmin — community feedback\nVendor blog post — vendor.com/blog/announcement"}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={save}><Save className="h-3 w-3 mr-1" />Save</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>Cancel</Button>
            </div>
          </div>
        );
      })()}
      <div className="overflow-x-auto rounded-lg border max-h-64">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b">
              <th className="text-left p-2 text-gray-600 w-28">Vendor</th>
              {pageFeatures.map(f => <th key={f} className="p-1.5 text-gray-600 text-center whitespace-nowrap max-w-16 truncate" title={f}>{f.slice(0, 12)}</th>)}
            </tr>
          </thead>
          <tbody>{vendors.map(v => (
            <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
              <td className="p-2 font-medium whitespace-nowrap">{v}</td>
              {pageFeatures.map(f => {
                const s = get(v, f);
                return <td key={f} className="p-1 text-center">
                  <button onClick={() => { setSelected({ v, f }); setEditLevel(s?.supportLevel ?? 0); setEditComments(s?.comments ?? ""); setEditSources(s?.sources ?? []); }}
                    className={`text-base hover:scale-110 transition-transform ${lcolor(s?.supportLevel ?? 0)}`}
                    title={s?.comments}>{HARVEY[s?.supportLevel ?? 0]?.split(" ")[0] ?? "✕"}</button>
                </td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Click any Harvey Ball to edit the support level and commentary.</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</Button>
            <span className="text-gray-600 font-medium">
              Features {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, features.length)} of {features.length}
            </span>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next →</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stage4Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const support = result?.support ?? [];
  const cats = result?.categories ?? [];
  const totalFeatures = cats.length > 0
    ? cats.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0)
    : [...new Set<string>(support.map((s: any) => s.featureName))].length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
        <BarChart3 className="h-3.5 w-3.5 text-green-600 shrink-0" />
        <span><strong>{[...new Set<string>(support.map((s: any) => s.vendorName))].length}</strong> vendors · <strong>{totalFeatures}</strong> product features · <strong>{support.length}</strong> total scores</span>
      </div>
      <HarveyBallGrid
        support={support}
        onChange={s => onChange({ ...result, support: s })}
        label="Product Capability Scores"
      />
    </div>
  );
}

function Stage5Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const cats = result?.categories ?? [];
  const totalFeatures = cats.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
        <Layers className="h-3.5 w-3.5 text-purple-600 shrink-0" />
        <span><strong>{cats.length}</strong> ecosystem categories · <strong>{totalFeatures}</strong> integration points defined</span>
      </div>
      <FeatureCategoryEditor result={result} onChange={onChange} addCatLabel="Add Ecosystem Category" />
    </div>
  );
}

function Stage6Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const cats = result?.categories ?? [];
  const support = result?.support ?? [];
  const totalFeatures = cats.length > 0
    ? cats.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0)
    : [...new Set<string>(support.map((s: any) => s.featureName))].length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
        <BarChart3 className="h-3.5 w-3.5 text-purple-600 shrink-0" />
        <span><strong>{[...new Set<string>(support.map((s: any) => s.vendorName))].length}</strong> vendors · <strong>{totalFeatures}</strong> ecosystem integrations · <strong>{support.length}</strong> total scores</span>
      </div>
      <HarveyBallGrid
        support={support}
        onChange={s => onChange({ ...result, support: s })}
        label="Ecosystem Integration Scores"
      />
    </div>
  );
}

// ── Per-stage LLM picker ──────────────────────────────────────────────────

// Keep in sync with LLM_MODELS in server/market-builder/llm.ts
const PROVIDER_MODELS: Record<string, string[]> = {
  openai:      ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"],
  anthropic:   ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  perplexity:  ["sonar-pro", "sonar", "sonar-reasoning-pro", "sonar-reasoning", "sonar-deep-research"],
};

function StageLlmPicker({ jobId, stageNum, defaultProvider, defaultModel, apiBase }: {
  jobId: string; stageNum: number; defaultProvider: string; defaultModel: string; apiBase: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: existing, refetch } = useQuery<{ provider: string; model: string } | null>({
    queryKey: [`${apiBase}/jobs/${jobId}/stage-llm/${stageNum}`],
    queryFn: () =>
      fetch(`${apiBase}/jobs/${jobId}/stage-llm/${stageNum}`)
        .then(r => r.ok ? r.json() : null),
    staleTime: 30_000,
  });

  const [selProvider, setSelProvider] = useState(defaultProvider);
  const [selModel, setSelModel]       = useState(defaultModel);

  useEffect(() => {
    if (existing) { setSelProvider(existing.provider); setSelModel(existing.model); }
    else           { setSelProvider(defaultProvider);   setSelModel(defaultModel); }
  }, [existing, defaultProvider, defaultModel]);

  const save = useMutation({
    mutationFn: () => apiRequest(`${apiBase}/jobs/${jobId}/stage-llm/${stageNum}`, "PUT", { provider: selProvider, model: selModel }).then(r => r.json()),
    onSuccess: () => { refetch(); setOpen(false); },
  });
  const clear = useMutation({
    mutationFn: () => apiRequest(`${apiBase}/jobs/${jobId}/stage-llm/${stageNum}`, "DELETE"),
    onSuccess: () => { refetch(); setOpen(false); setSelProvider(defaultProvider); setSelModel(defaultModel); },
  });

  const isOverridden = !!existing;
  const displayProvider = isOverridden ? existing!.provider : defaultProvider;
  const displayModel    = isOverridden ? existing!.model    : defaultModel;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-gray-500" />
          <span className="text-xs font-semibold text-gray-700">Stage {stageNum} LLM</span>
          {isOverridden
            ? <Badge variant="outline" className="text-xs py-0 border-violet-300 text-violet-700 bg-violet-50">Custom</Badge>
            : <Badge variant="outline" className="text-xs py-0 text-gray-400">Job default</Badge>
          }
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 font-mono">{displayProvider}/{displayModel}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setOpen(o => !o)}>
            <ChevronDown className="h-3 w-3" />{open ? "Close" : "Change"}
          </Button>
        </div>
      </div>
      {open && (
        <div className="pt-2 border-t space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Provider</Label>
              <Select value={selProvider} onValueChange={p => { setSelProvider(p); setSelModel(PROVIDER_MODELS[p]?.[0] ?? ""); }}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(PROVIDER_MODELS).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Model</Label>
              <Select value={selModel} onValueChange={setSelModel}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{(PROVIDER_MODELS[selProvider] ?? []).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}Save Override
            </Button>
            {isOverridden && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" onClick={() => clear.mutate()} disabled={clear.isPending}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stage 2: Scoring-only editor (numeric, no commentary) ─────────────────

function Stage2ScoringEditor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const weights: any[] = result?.criteriaWeights ?? [];
  const scores: any[] = result?.scores ?? [];
  const [selected, setSelected] = useState<{ v: string; c: string } | null>(null);
  const [editScore, setEditScore] = useState("");

  const updateWeight = (criterionName: string, weight: number) =>
    onChange({ ...result, criteriaWeights: weights.map((w: any) => w.criterionName === criterionName ? { ...w, weight } : w) });

  const getScore = (v: string, c: string) => scores.find((s: any) => s.vendorName === v && s.criterionName === c);
  const saveScore = () => {
    if (!selected) return;
    onChange({ ...result, scores: scores.map((s: any) => s.vendorName === selected.v && s.criterionName === selected.c ? { ...s, score: parseFloat(editScore) || s.score } : s) });
    setSelected(null);
  };

  const vendors = [...new Set<string>(scores.map((s: any) => s.vendorName))];
  const scoreCellColor = (s: number) => s >= 8 ? "bg-green-100 text-green-800" : s >= 6 ? "bg-blue-100 text-blue-800" : s >= 4 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

  return (
    <div className="space-y-5">
      {["execution", "viability"].map(axis => {
        const axisCriteria = weights.filter((w: any) => (w.criterionCategory ?? "").toLowerCase() === axis);
        if (!axisCriteria.length) return null;
        return (
          <div key={axis}>
            <p className="text-sm font-semibold capitalize text-gray-700 mb-2">{axis} Axis — Criteria</p>
            <div className="space-y-2">
              {axisCriteria.map((w: any) => (
                <div key={w.criterionName} className="rounded-lg border bg-white p-3 flex items-center gap-3">
                  <p className="text-xs font-semibold text-gray-800 flex-1">{w.criterionName}</p>
                  {AUTO_COMPUTED_CRITERIA.has(w.criterionName)
                    ? <span className="text-xs text-amber-500 border border-amber-200 rounded px-2 py-0.5 bg-amber-50 cursor-default">auto</span>
                    : <>
                        <Label className="text-xs text-gray-400 shrink-0">Weight</Label>
                        <Input type="number" min={1} max={100} value={w.weight}
                          onChange={e => updateWeight(w.criterionName, parseInt(e.target.value) || 1)}
                          className="h-7 text-xs w-14 text-center" />
                      </>
                  }
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {selected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.c}</p>
          <div className="flex items-center gap-3">
            <Label className="text-xs">Score (0–10)</Label>
            <Input type="number" min={0} max={10} step={0.1} value={editScore} onChange={e => setEditScore(e.target.value)} className="h-7 text-xs text-center w-24" />
          </div>
          <p className="text-xs text-gray-500">Commentary will be written in Stage 3.</p>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={saveScore}><Save className="h-3 w-3 mr-1" />Save</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <strong>Product Capabilities</strong> and <strong>ISV Ecosystem</strong> scores are locked —
          auto-computed from Harvey Ball data at publish time.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Vendor Scores (0–10)</p>
        <div className="overflow-x-auto rounded-lg border text-xs">
          <table className="w-full">
            <thead><tr className="bg-gray-50 border-b">
              <th className="text-left p-2 text-gray-600 w-32">Vendor</th>
              {weights.map((w: any) => (
                <th key={w.criterionName} className={`p-2 text-center whitespace-nowrap max-w-20 truncate ${AUTO_COMPUTED_CRITERIA.has(w.criterionName) ? "text-amber-600" : "text-gray-600"}`}>
                  {w.criterionName}
                  {AUTO_COMPUTED_CRITERIA.has(w.criterionName) && <Lock className="inline h-2.5 w-2.5 ml-0.5 mb-0.5" />}
                </th>
              ))}
            </tr></thead>
            <tbody>{vendors.map(v => (
              <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2 font-medium whitespace-nowrap">{v}</td>
                {weights.map((w: any) => {
                  const s = getScore(v, w.criterionName);
                  const isLocked = AUTO_COMPUTED_CRITERIA.has(w.criterionName);
                  if (isLocked) return <td key={w.criterionName} className="p-1 text-center"><span className="rounded px-2 py-0.5 text-xs font-mono font-semibold bg-amber-50 text-amber-500 border border-amber-200">auto</span></td>;
                  return (
                    <td key={w.criterionName} className="p-1 text-center">
                      <button onClick={() => { setSelected({ v, c: w.criterionName }); setEditScore(s?.score?.toString() ?? ""); }}
                        className={`rounded px-2 py-0.5 text-xs font-mono font-semibold hover:ring-2 hover:ring-blue-300 ${scoreCellColor(s?.score ?? 0)}`}>
                        {s?.score?.toFixed(1) ?? "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-1">Click any unlocked score to edit. Commentary is added separately in Stage 3.</p>
      </div>
    </div>
  );
}

// ── Harvey Ball scores-only grid (no commentary edit) ────────────────────

function HarveyBallScoreOnlyGrid({ support, onChange, label }: { support: any[]; onChange: (s: any[]) => void; label?: string }) {
  const vendors  = [...new Set<string>(support.map((s: any) => s.vendorName))];
  const features = [...new Set<string>(support.map((s: any) => s.featureName))];
  const PAGE_SIZE = 22;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(features.length / PAGE_SIZE));
  const pageStart  = page * PAGE_SIZE;
  const pageFeatures = features.slice(pageStart, pageStart + PAGE_SIZE);
  const HARVEY  = ["✕ None", "◔ Limited", "◑ Partial", "◕ Good", "● Full"];
  const lcolor  = (l: number) => ["text-gray-300","text-red-400","text-yellow-500","text-blue-500","text-green-600"][l] ?? "";
  const get = (v: string, f: string) => support.find((s: any) => s.vendorName === v && s.featureName === f);

  const cycle = (v: string, f: string) => {
    const cur = get(v, f)?.supportLevel ?? 0;
    const next = (cur + 1) % 5;
    onChange(support.map(s => s.vendorName === v && s.featureName === f ? { ...s, supportLevel: next } : s));
  };

  return (
    <div className="space-y-3">
      {label && <p className="text-sm font-semibold text-gray-700">{label}</p>}
      <div className="overflow-x-auto rounded-lg border max-h-72">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b">
              <th className="text-left p-2 text-gray-600 w-28">Vendor</th>
              {pageFeatures.map(f => <th key={f} className="p-1.5 text-gray-600 text-center whitespace-nowrap max-w-16 truncate" title={f}>{f.slice(0, 12)}</th>)}
            </tr>
          </thead>
          <tbody>{vendors.map(v => (
            <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
              <td className="p-2 font-medium whitespace-nowrap">{v}</td>
              {pageFeatures.map(f => {
                const s = get(v, f);
                return (
                  <td key={f} className="p-1 text-center">
                    <button
                      onClick={() => cycle(v, f)}
                      className={`text-base hover:scale-110 transition-transform ${lcolor(s?.supportLevel ?? 0)}`}
                      title={`Click to cycle: ${HARVEY[s?.supportLevel ?? 0]}`}
                    >
                      {HARVEY[s?.supportLevel ?? 0]?.split(" ")[0] ?? "✕"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Click any Harvey Ball to cycle the score. Commentary added in the next stage.</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</Button>
            <span className="text-gray-600 font-medium">
              Features {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, features.length)} of {features.length}
            </span>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next →</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sources-only notice ───────────────────────────────────────────────────

function SourcesOnlyNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
      <FileSearch className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <p className="text-xs text-amber-800">
        <strong>Sources-only mode:</strong> Once you add sources below, the AI will use <em>only</em> the content from those sources for this stage — not its general knowledge. Leave empty to allow the AI to use its training data.
      </p>
    </div>
  );
}

// ── Publish panel ─────────────────────────────────────────────────────────

function PublishPanel({ job, stageResults, onPublished, apiBase, mode }: {
  job: MarketBuilderJob;
  stageResults: Record<number, any>;
  onPublished: (marketId: string, isVisible: boolean) => void;
  apiBase: string;
  mode: "admin" | "user";
}) {
  const { toast } = useToast();
  // End-user markets are always private — the visibility toggle only makes
  // sense for admin-published public markets.
  const [isVisible, setIsVisible] = useState(false);
  const s1 = stageResults[1]; const s2 = stageResults[3]; const s3 = stageResults[4]; const s4 = stageResults[6];
  const s5 = stageResults[7]; const s6 = stageResults[9];
  const productFeatures = s3?.categories?.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0) ?? 0;
  const ecoFeatures = s5?.categories?.reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0) ?? 0;
  const publish = useMutation({
    mutationFn: () => apiRequest(`${apiBase}/jobs/${job.id}/publish`, "POST", { isVisible }).then(r => r.json()),
    onSuccess: (data: any) => { onPublished(data.marketId, isVisible); toast({ title: "Market published!" }); },
    onError: (err: any) => toast({ title: "Publish failed", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="rounded-xl border-2 border-green-200 bg-green-50 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-green-900">All Stages Approved — Ready to Publish</h3>
        <p className="text-sm text-green-700 mt-0.5">Review the summary, set visibility, then publish to create the market.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: "Vendors", v: s1?.vendors?.length ?? 0 },
          { l: "Criteria", v: s2?.criteriaWeights?.length ?? 0 },
          { l: "Product Features", v: productFeatures },
          { l: "Ecosystem Features", v: ecoFeatures },
        ].map(({ l, v }) => (
          <div key={l} className="rounded-lg bg-white border border-green-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-800">{v}</p>
            <p className="text-xs text-green-600">{l}</p>
          </div>
        ))}
      </div>
      {mode === "admin" ? (
        <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4">
          <Switch checked={isVisible} onCheckedChange={setIsVisible} />
          <div>
            <p className="text-sm font-medium text-gray-800">Make market visible immediately</p>
            <p className="text-xs text-gray-500">If off, the market is created but hidden — enable it later from the Markets admin tab.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4">
          <Lock className="h-4 w-4 text-green-700" />
          <div>
            <p className="text-sm font-medium text-gray-800">Private market</p>
            <p className="text-xs text-gray-500">Only you will be able to see this market and its reports.</p>
          </div>
        </div>
      )}
      <Button className="w-full gap-2 bg-green-700 hover:bg-green-800 h-10" onClick={() => publish.mutate()} disabled={publish.isPending}>
        {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Publish Market
      </Button>
    </div>
  );
}

// ── Done stage view ───────────────────────────────────────────────────────

function DoneStageView({ stageNum, result, jobId, onSave, apiBase }: {
  stageNum: number; result: any; jobId: string; onSave: (r: any) => void; apiBase: string;
}) {
  const [localResult, setLocalResult] = useState(result);
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => { setLocalResult(result); setIsDirty(false); }, [result]);
  const handleChange = (r: any) => { setLocalResult(r); setIsDirty(true); };
  return (
    <div className="space-y-5">
      <SourcesPanel jobId={jobId} currentStage={stageNum} apiBase={apiBase} />
      {isDirty && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-xs text-amber-800 font-medium">You have unsaved edits</p>
          <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 gap-1" onClick={() => onSave(localResult)}>
            <Save className="h-3 w-3" />Save Changes
          </Button>
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-3">Results — edit anything before approving</p>
        {stageNum === 1 && <Stage1Editor result={localResult} onChange={handleChange} />}
        {stageNum === 2 && <Stage2ScoringEditor result={localResult} onChange={handleChange} />}
        {stageNum === 3 && <Stage2Editor result={localResult} onChange={handleChange} />}
        {stageNum === 4 && <Stage3Editor result={localResult} onChange={handleChange} />}
        {stageNum === 5 && <HarveyBallScoreOnlyGrid support={localResult?.support ?? []} onChange={s => handleChange({ ...localResult, support: s })} label="Product Feature Scores (Harvey Ball)" />}
        {stageNum === 6 && <Stage4Editor result={localResult} onChange={handleChange} />}
        {stageNum === 7 && <Stage5Editor result={localResult} onChange={handleChange} />}
        {stageNum === 8 && <HarveyBallScoreOnlyGrid support={localResult?.support ?? []} onChange={s => handleChange({ ...localResult, support: s })} label="Ecosystem Integration Scores (Harvey Ball)" />}
        {stageNum === 9 && <Stage6Editor result={localResult} onChange={handleChange} />}
      </div>
    </div>
  );
}

// ── Dashboard — project cards ─────────────────────────────────────────────

function statusColor(s: string) {
  return {
    completed: "text-green-700 border-green-300 bg-green-50",
    published:  "text-blue-700 border-blue-300 bg-blue-50",
    running:    "text-amber-700 border-amber-300 bg-amber-50",
    failed:     "text-red-700 border-red-300 bg-red-50",
    idle:       "text-gray-600 border-gray-300 bg-gray-50",
  }[s] ?? "text-gray-600 border-gray-300";
}

function stagesCompletedCount(summary: Record<number, string>) {
  return [1,2,3,4,5,6,7,8,9].filter(n => summary[n] === "completed").length;
}

function nextPendingStage(summary: Record<number, string>): number {
  for (let n = 1; n <= 9; n++) {
    if (summary[n] !== "completed") return n;
  }
  return 10; // all done
}

function ProjectCard({ job, onResume, onDelete }: {
  job: MarketBuilderJob;
  onResume: (j: MarketBuilderJob) => void;
  onDelete: (id: string) => void;
}) {
  const summary = job.stageSummary ?? {};
  const done = stagesCompletedCount(summary);
  const next = nextPendingStage(summary);
  const isPublished = job.status === "published";
  const isFailed = job.status === "failed";
  const dateStr = new Date(job.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <Card className="group relative hover:shadow-md transition-shadow border-gray-200 overflow-hidden">
      {/* Progress bar along the top */}
      <div className="h-1 bg-gray-100">
        <div
          className={`h-full transition-all ${isPublished ? "bg-blue-500" : done === 9 ? "bg-green-500" : isFailed ? "bg-red-400" : "bg-amber-400"}`}
          style={{ width: `${(done / 9) * 100}%` }}
        />
      </div>

      <CardContent className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate text-base leading-tight">{job.inputName}</h3>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{job.inputDescription}</p>
          </div>
          <Badge variant="outline" className={`text-xs shrink-0 capitalize ${statusColor(job.status)}`}>{job.status}</Badge>
        </div>

        {/* Stage progress dots */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 font-medium">Stage progress</p>
            <p className="text-xs text-gray-500 font-semibold">{done}/9 complete</p>
          </div>
          <StageDots stageSummary={summary} />
          <div className="flex gap-2 text-xs text-gray-400">
            {STAGE_META.map((s, i) => (
              <span key={s.num} className={`flex-1 text-center truncate ${summary[s.num] === "completed" ? "text-green-600 font-medium" : summary[s.num] === "running" ? "text-blue-500 font-medium" : "text-gray-300"}`}>{s.label}</span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{dateStr}</span>
            <span>·</span>
            <span className="capitalize">{job.llmProvider}</span>
          </div>
          <div className="flex items-center gap-1">
            {isPublished && job.marketId && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-blue-600 hover:text-blue-700" onClick={() => window.open(`/markets/${job.marketId}`, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" />View
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={e => { e.stopPropagation(); onDelete(job.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            {!isPublished && (
              <Button size="sm" className="h-7 px-3 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700" onClick={() => onResume(job)}>
                {done === 9 ? <><CheckCircle2 className="h-3.5 w-3.5" />Publish</> : <><ArrowRight className="h-3.5 w-3.5" />Continue — Stage {next}</>}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Setup form (New Market) ───────────────────────────────────────────────

function SetupForm({ onBack, onCreate, mode = "admin" }: {
  onBack: () => void;
  onCreate: (data: any) => void;
  mode?: "admin" | "user";
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4.1-mini");

  const handleSubmit = () => {
    if (!name.trim() || !description.trim()) {
      toast({ title: "Please fill in the market name and description", variant: "destructive" });
      return;
    }
    onCreate({ inputName: name.trim(), inputDescription: description.trim(), inputCategory: category || undefined, inputContext: context.trim() || undefined, llmProvider: provider, llmModel: model });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />Back to Projects
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">New Market</h2>
          <p className="text-sm text-gray-500 mt-0.5">Describe the technology market. AI will generate all data across 9 stages — you approve each one.</p>
        </div>
        <LLMSelector provider={provider} model={model} onProviderChange={setProvider} onModelChange={setModel} mode={mode} />
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Market Name *</Label>
          <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Enterprise Object Storage" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description *</Label>
          <Textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What technology? Who buys it? What problem does it solve?" rows={4} className="resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Extra context <span className="text-gray-400">(optional)</span></Label>
          <Textarea value={context} onChange={e=>setContext(e.target.value)} placeholder="Specific vendors to include, regional focus, buyer segment…" rows={2} className="resize-none" />
        </div>
        <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700 h-10" onClick={handleSubmit}>
          <Sparkles className="h-4 w-4" />Start Building
        </Button>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────

export function MarketBuilderWizard({ mode = "admin" }: { mode?: "admin" | "user" } = {}) {
  const { toast } = useToast();
  // API base differs for admin vs end-user surfaces. Sub-components are
  // passed apiBase/promptsBase so they hit the right routes.
  const apiBase = mode === "user" ? "/api/market-builder" : "/api/admin/market-builder";
  const promptsBase = mode === "user" ? "/api/me/prompts" : "/api/admin/prompts";

  const [view, setView] = useState<WizardView>("dashboard");
  const [activeJob, setActiveJob] = useState<MarketBuilderJob | null>(null);
  const [activeStage, setActiveStage] = useState(1);

  const [stagePhases, setStagePhases] = useState<Record<number, StagePhase>>({});
  const [stageResults, setStageResults] = useState<Record<number, any>>({});
  const [streamError, setStreamError] = useState<string | null>(null);

  const [publishedMarketId, setPublishedMarketId] = useState<string | null>(null);
  const [publishedVisible, setPublishedVisible] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const { data: jobs = [], refetch: refetchJobs } = useQuery<MarketBuilderJob[]>({
    queryKey: [apiBase, "jobs"],
    refetchInterval: view === "stages" ? 0 : 15_000, // auto-refresh dashboard every 15s
  });

  const { data: allCriteria = [] } = useQuery<{ id: string; name: string; description: string | null; category: string }[]>({
    queryKey: ["/api/criteria"],
  });

  // ── Activity log: poll DB every 2.5 s while a stage is running ───────────
  // This survives navigation — when the user leaves and comes back, the log
  // is re-fetched from DB immediately so they see everything that happened.

  const pollingEnabled = view === "stages" && stagePhases[activeStage] === "running" && !!activeJob;
  const { data: progressData } = useQuery<{ progressLog: string; status: string }>({
    queryKey: [`${apiBase}/jobs/${activeJob?.id}/stages/${activeStage}/progress`],
    enabled: pollingEnabled,
    refetchInterval: pollingEnabled ? 2500 : false,
  });

  const activityLines = useMemo(() => {
    const raw = progressData?.progressLog ?? "";
    return raw ? raw.split("\n").filter(Boolean) : [];
  }, [progressData]);

  // Auto-scroll to bottom of log whenever new lines arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLines.length]);

  // ── SSE: run a single stage ───────────────────────────────────────────

  const runStage = (jobId: string, stageNum: number) => {
    esRef.current?.close();
    setStreamError(null);
    // Reset cached progress log so the new run starts fresh in the UI
    queryClient.resetQueries({
      queryKey: [`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`],
    });
    setStagePhases(prev => ({ ...prev, [stageNum]: "running" }));

    const es = new EventSource(`${apiBase}/jobs/${jobId}/stream?stage=${stageNum}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "stage_complete") {
          setStageResults(prev => ({ ...prev, [stageNum]: event.result }));
          setStagePhases(prev => ({ ...prev, [stageNum]: "done" }));
          // Final poll to capture any last log lines written just before completion
          queryClient.invalidateQueries({
            queryKey: [`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`],
          });
          refetchJobs();
          es.close();
        } else if (event.type === "stage_error") {
          setStagePhases(prev => ({ ...prev, [stageNum]: "failed" }));
          setStreamError(event.error ?? "Stage failed");
          queryClient.invalidateQueries({
            queryKey: [`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`],
          });
          es.close();
        }
        // stage_progress events are handled via DB polling — no local state needed
      } catch (_) {}
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // SSE proxy timeout is common for long-running stages (6, 9).
      // Don't mark failed immediately — the stage is still running server-side.
      // Switch to DB polling every 5 s until the stage actually completes or fails.
      setStreamError("Stream disconnected — stage is still running on the server. Monitoring for completion…");

      if (fallbackPollRef.current) clearInterval(fallbackPollRef.current);
      fallbackPollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`, { credentials: "include" });
          if (!r.ok) return;
          const data: { status: string; progressLog: string } = await r.json();

          if (data.status === "completed") {
            clearInterval(fallbackPollRef.current!);
            fallbackPollRef.current = null;
            setStreamError(null);
            // Load the stage result from the full job object
            try {
              const jobRes = await fetch(`${apiBase}/jobs/${jobId}`, { credentials: "include" });
              if (jobRes.ok) {
                const fullJob = await jobRes.json();
                const stageData = (fullJob.stages ?? []).find((s: any) => s.stage === stageNum);
                if (stageData?.result) {
                  setStageResults(prev => ({ ...prev, [stageNum]: stageData.result }));
                }
              }
            } catch (_) {}
            setStagePhases(prev => ({ ...prev, [stageNum]: "done" }));
            queryClient.invalidateQueries({ queryKey: [`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`] });
            refetchJobs();

          } else if (data.status === "failed") {
            clearInterval(fallbackPollRef.current!);
            fallbackPollRef.current = null;
            setStagePhases(prev => ({ ...prev, [stageNum]: "failed" }));
            const lastLine = (data.progressLog ?? "").split("\n").filter(Boolean).pop() ?? "";
            setStreamError(lastLine.replace(/^✗ Error:\s*/, "") || "Stage failed — check the activity log.");
            queryClient.invalidateQueries({ queryKey: [`${apiBase}/jobs/${jobId}/stages/${stageNum}/progress`] });
          }
          // status === "running" → keep polling
        } catch (_) {}
      }, 5000);
    };
  };

  useEffect(() => () => {
    esRef.current?.close();
    if (fallbackPollRef.current) clearInterval(fallbackPollRef.current);
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────

  const createJob = useMutation({
    mutationFn: (data: any) => apiRequest(`${apiBase}/jobs`, "POST", data).then(r => r.json()),
    onSuccess: (job: MarketBuilderJob) => {
      setActiveJob(job);
      setView("stages");
      setActiveStage(1);
      setStagePhases({ 1: "ready" });
      setStageResults({});
      setStreamError(null);
      refetchJobs();
    },
    onError: (err: any) => toast({ title: "Failed to create job", description: err.message, variant: "destructive" }),
  });

  const completeJob = useMutation({
    mutationFn: (id: string) => apiRequest(`${apiBase}/jobs/${id}/complete`, "POST").then(r => r.json()),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveEdits = useMutation({
    mutationFn: ({ stageNum, result }: { stageNum: number; result: any }) =>
      apiRequest(`${apiBase}/jobs/${activeJob!.id}/stages/${stageNum}/result`, "PATCH", result).then(r => r.json()),
    onSuccess: () => toast({ title: "Edits saved" }),
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteJob = useMutation({
    mutationFn: (id: string) => apiRequest(`${apiBase}/jobs/${id}`, "DELETE"),
    onSuccess: () => {
      refetchJobs();
      // My Reports uses a flat query key — bust its cache too so deleted jobs
      // don't keep showing as "Running" there after deletion.
      queryClient.invalidateQueries({ queryKey: ["/api/market-builder/jobs"] });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const updateVisibility = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      apiRequest(`${apiBase}/jobs/${id}/visibility`, "PATCH", { isVisible }).then(r => r.json()),
    onSuccess: (_, { isVisible }) => { setPublishedVisible(isVisible); toast({ title: isVisible ? "Market now visible" : "Market now hidden" }); },
  });

  // ── Approve stage and advance ─────────────────────────────────────────

  const approveStage = async (stageNum: number) => {
    if (stageNum === 9) {
      await completeJob.mutateAsync(activeJob!.id);
      setActiveStage(10);
    } else {
      setActiveStage(stageNum + 1);
      // Only initialise the next stage as "ready" if it hasn't already been run.
      // Overwriting "done" with "ready" would hide completed results when the
      // user navigates back to a prior stage and clicks Approve again.
      setStagePhases(prev => {
        const nextPhase = prev[stageNum + 1];
        if (nextPhase === "done" || nextPhase === "failed") return prev;
        return { ...prev, [stageNum + 1]: "ready" };
      });
    }
    refetchJobs();
  };

  // ── Resume an existing job ────────────────────────────────────────────

  const handleResume = (job: MarketBuilderJob) => {
    setActiveJob(job);
    setView("stages");
    setStreamError(null);

    const phases: Record<number, StagePhase> = {};
    const results: Record<number, any> = {};
    let highestDone = 0;

    let runningStage: number | null = null;

    (job.stages ?? []).forEach(s => {
      if (s.status === "completed" && s.result) {
        phases[s.stage] = "done";
        results[s.stage] = s.result;
        highestDone = Math.max(highestDone, s.stage);
      } else if (s.status === "failed") {
        phases[s.stage] = "failed";
      } else if (s.status === "running") {
        phases[s.stage] = "running";
        runningStage = s.stage;
      }
    });

    // Also use stageSummary for jobs loaded from the list (no full stage data)
    if (Object.keys(phases).length === 0 && job.stageSummary) {
      Object.entries(job.stageSummary).forEach(([stageStr, status]) => {
        const n = parseInt(stageStr);
        if (status === "completed") { phases[n] = "done"; highestDone = Math.max(highestDone, n); }
        else if (status === "failed") phases[n] = "failed";
        else if (status === "running") { phases[n] = "running"; runningStage = n; }
      });
    }

    setStageResults(results);

    if (job.status === "completed" || job.status === "published") {
      setActiveStage(10);
    } else if (runningStage !== null) {
      // A stage was running when we left — jump straight to it; polling will resume
      setActiveStage(runningStage);
    } else {
      const nextStage = Math.min(highestDone + 1, 9);
      setActiveStage(nextStage);
      if (!phases[nextStage]) phases[nextStage] = "ready";
    }
    setStagePhases(phases);

    // If we need full stage results, fetch the job with stages
    if (Object.keys(results).length === 0 && highestDone > 0) {
      apiRequest(`${apiBase}/jobs/${job.id}`, "GET").then(r => r.json()).then((fullJob: any) => {
        const r2: Record<number, any> = {};
        const p2: Record<number, StagePhase> = { ...phases };
        let hd2 = 0;
        (fullJob.stages ?? []).forEach((s: any) => {
          if (s.status === "completed" && s.result) { r2[s.stage] = s.result; p2[s.stage] = "done"; hd2 = Math.max(hd2, s.stage); }
          else if (s.status === "failed") p2[s.stage] = "failed";
        });
        setStageResults(r2);
        const next2 = Math.min(hd2 + 1, 9);
        if (!p2[next2] && hd2 < 9) p2[next2] = "ready";
        setStagePhases(p2);
        if (job.status !== "completed" && job.status !== "published") setActiveStage(next2);
      }).catch(() => {});
    }
  };

  const currentMeta = STAGE_META.find(s => s.num === activeStage);
  const currentPhase = stagePhases[activeStage];
  const currentResult = stageResults[activeStage];

  // ── Published view ────────────────────────────────────────────────────

  if (view === "published") {
    return (
      <div className="max-w-lg space-y-5">
        <div className="rounded-xl border-2 border-green-200 bg-green-50 p-8 text-center space-y-4">
          <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />
          <div>
            <h2 className="text-xl font-bold text-green-900">Market Created!</h2>
            <p className="text-sm text-green-700 mt-1">{activeJob?.inputName}</p>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4 text-left">
            <Switch checked={publishedVisible} onCheckedChange={v => activeJob && updateVisibility.mutate({ id: activeJob.id, isVisible: v })} />
            <div>
              <p className="text-sm font-medium">{publishedVisible ? <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-green-600"/>Visible to users</span> : <span className="flex items-center gap-1"><EyeOff className="h-3.5 w-3.5 text-gray-400"/>Hidden (draft)</span>}</p>
              <p className="text-xs text-gray-500">Toggle visibility at any time.</p>
            </div>
          </div>
          <div className="flex gap-3">
            {publishedMarketId && <Button variant="outline" className="flex-1 text-sm gap-2" onClick={() => window.open(`/markets/${publishedMarketId}`, "_blank")}><ExternalLink className="h-4 w-4"/>Preview</Button>}
            <Button className="flex-1 text-sm gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => { setView("dashboard"); setActiveJob(null); setStageResults({}); setStagePhases({}); setPublishedMarketId(null); refetchJobs(); }}>
              <FolderOpen className="h-4 w-4"/>Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard view ────────────────────────────────────────────────────

  if (view === "dashboard") {
    const draftJobs = jobs.filter(j => j.status !== "published");
    const publishedJobs = jobs.filter(j => j.status === "published");

    return (
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-blue-600" />AI Market Builder
              <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Beta</Badge>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">AI-powered market research — 9 stages, each waiting for your review and approval.</p>
          </div>
          <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => setView("new-setup")}>
            <Plus className="h-4 w-4" />New Market
          </Button>
        </div>

        {/* Empty state */}
        {jobs.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
              <Wand2 className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">No markets built yet</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Describe a technology market and AI will generate vendors, criteria, features, and scores across 9 approval stages.</p>
            </div>
            <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => setView("new-setup")}>
              <Sparkles className="h-4 w-4" />Start Building Your First Market
            </Button>
          </div>
        )}

        {/* Draft / In-progress projects */}
        {draftJobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">In Progress</h2>
              <Badge variant="outline" className="text-xs text-gray-400 border-gray-200">{draftJobs.length}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
              {draftJobs.map(job => (
                <ProjectCard
                  key={job.id}
                  job={job}
                  onResume={handleResume}
                  onDelete={id => deleteJob.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Published markets */}
        {publishedJobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Published</h2>
              <Badge variant="outline" className="text-xs text-gray-400 border-gray-200">{publishedJobs.length}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
              {publishedJobs.map(job => (
                <ProjectCard
                  key={job.id}
                  job={job}
                  onResume={handleResume}
                  onDelete={id => deleteJob.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── New setup form ────────────────────────────────────────────────────

  if (view === "new-setup") {
    return (
      <SetupForm
        onBack={() => setView("dashboard")}
        onCreate={data => createJob.mutate(data)}
        mode={mode}
      />
    );
  }

  // ── Stages view ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 -ml-2" onClick={() => { esRef.current?.close(); setView("dashboard"); }}>
              <ChevronLeft className="h-4 w-4" />Projects
            </Button>
            <span className="text-gray-300">/</span>
            <h1 className="text-base font-semibold text-gray-900">{activeJob?.inputName}</h1>
          </div>
          <p className="text-xs text-gray-400 ml-1">{activeJob?.llmProvider} / {activeJob?.llmModel}</p>
        </div>
      </div>

      {/* Step tracker */}
      <div className="rounded-xl border bg-white p-3">
        <StepTracker
          activeStage={activeStage}
          stagePhases={stagePhases}
          onStepClick={n => { if (stagePhases[n] === "done") setActiveStage(n); }}
        />
      </div>

      {/* Publish panel (stage 10 = all 9 stages done) */}
      {activeStage === 10 && (
        <PublishPanel
          job={activeJob!}
          stageResults={stageResults}
          apiBase={apiBase}
          mode={mode}
          onPublished={(marketId, isVisible) => {
            setPublishedMarketId(marketId);
            setPublishedVisible(isVisible);
            setView("published");
            refetchJobs();
          }}
        />
      )}

      {/* Active stage panel (stages 1–9) */}
      {activeStage <= 9 && currentMeta && (
        <div className="rounded-xl border bg-white">
          <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Stage {activeStage} of 9</span>
                {currentPhase === "running" && <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 gap-1 text-xs py-0"><Loader2 className="h-3 w-3 animate-spin"/>Running</Badge>}
                {currentPhase === "done" && <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs py-0">Complete</Badge>}
                {currentPhase === "failed" && <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 text-xs py-0">Failed</Badge>}
              </div>
              <h2 className="text-lg font-bold text-gray-900">{currentMeta.label}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{currentMeta.desc}</p>
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" />
                Estimated run time: <span className="font-medium text-gray-500">{currentMeta.eta}</span>
              </p>
            </div>
            {currentPhase === "done" && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={() => runStage(activeJob!.id, activeStage)}>
                <RefreshCw className="h-3.5 w-3.5" />Re-run Stage
              </Button>
            )}
          </div>

          <div className="p-6 space-y-5">
            {/* READY / initial state */}
            {(currentPhase === "ready" || !currentPhase) && (
              <>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-1">
                  <p className="text-sm font-semibold text-gray-700">What this stage generates</p>
                  <p className="text-sm text-gray-500">{currentMeta.what}</p>
                </div>

                {/* Stage 2 only: show the predefined criteria the AI will score against */}
                {activeStage === 2 && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-blue-900">Scoring criteria</p>
                      <p className="text-xs text-blue-700 mt-0.5">The AI will assign a 0–10 numeric score for every vendor × criterion. Commentary is written separately in Stage 3.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(["execution", "viability"] as const).map(axis => {
                        const axisCriteria = allCriteria.filter(c => c.category === axis);
                        if (!axisCriteria.length) return null;
                        return (
                          <div key={axis}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                              {axis === "execution" ? "Execution (X-axis)" : "Viability (Y-axis)"}
                            </p>
                            <div className="space-y-2">
                              {axisCriteria.map(c => (
                                <div key={c.id} className="rounded border border-gray-200 bg-white px-3 py-2">
                                  <p className="text-xs font-semibold text-gray-800">{c.name}</p>
                                  {c.description && (
                                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{c.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <SourcesOnlyNotice />
                <SourcesPanel jobId={activeJob!.id} currentStage={activeStage} apiBase={apiBase} />

                {/* Per-stage LLM selector — shown on every stage */}
                <StageLlmPicker
                  jobId={activeJob!.id}
                  stageNum={activeStage}
                  defaultProvider={activeJob!.llmProvider}
                  defaultModel={activeJob!.llmModel}
                  apiBase={apiBase}
                />

                {/* Prompt customization — commentary stages only */}
                {activeStage === 3 && (
                  <PromptSelector
                    jobId={activeJob!.id}
                    stageKind="vendor_evaluation"
                    criteria={allCriteria.filter(c => c.name !== "Product Capabilities" && c.name !== "ISV Ecosystem")}
                    apiBase={apiBase}
                    promptsBase={promptsBase} mode={mode}
                  />
                )}
                {activeStage === 6 && (
                  <PromptSelector
                    jobId={activeJob!.id}
                    stageKind="product_evaluation"
                    categories={(stageResults[4]?.categories ?? []) as Array<{ name: string; features: Array<{ name: string }> }>}
                    apiBase={apiBase}
                    promptsBase={promptsBase} mode={mode}
                  />
                )}
                {activeStage === 9 && (
                  <PromptSelector
                    jobId={activeJob!.id}
                    stageKind="ecosystem_evaluation"
                    categories={(stageResults[7]?.categories ?? []) as Array<{ name: string; features: Array<{ name: string }> }>}
                    apiBase={apiBase}
                    promptsBase={promptsBase} mode={mode}
                  />
                )}

                <div className="flex items-center justify-between pt-2">
                  {activeStage > 1 ? (
                    <Button variant="outline" className="gap-2" onClick={() => setActiveStage(s => s - 1)}><ChevronLeft className="h-4 w-4" />Stage {activeStage - 1}</Button>
                  ) : <div />}
                  <Button className="gap-2 bg-blue-600 hover:bg-blue-700 px-6" onClick={() => runStage(activeJob!.id, activeStage)}>
                    <PlayCircle className="h-4 w-4" />Run Stage {activeStage}
                  </Button>
                </div>
              </>
            )}

            {/* RUNNING state */}
            {currentPhase === "running" && (
              <div className="flex flex-col gap-3">
                {streamError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
                    <Loader2 className="h-4 w-4 text-amber-600 animate-spin shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Connection to live stream dropped</p>
                      <p className="text-xs text-amber-700 mt-0.5">{streamError}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-3">
                    <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-700">AI is working on Stage {activeStage}: {currentMeta?.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Updates every few seconds · Page will refresh automatically when complete</p>
                    </div>
                  </div>
                )}

                {/* Activity log */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b border-gray-200">
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Activity Log</span>
                  </div>
                  <div className="h-56 overflow-y-auto p-3 font-mono text-xs space-y-1 scroll-smooth">
                    {activityLines.length === 0 ? (
                      <p className="text-gray-400 italic">Waiting for first update…</p>
                    ) : (
                      activityLines.map((line, i) => {
                        const isError = line.includes("✗");
                        const isSuccess = line.includes("✓");
                        return (
                          <p key={i} className={
                            isError   ? "text-red-600" :
                            isSuccess ? "text-green-700 font-medium" :
                                        "text-gray-700"
                          }>
                            {line}
                          </p>
                        );
                      })
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>

                {/* Stuck-stage escape hatch — shown after 30 s with no log updates */}
                {activityLines.length === 0 && (
                  <StuckStageReset
                    jobId={activeJob!.id}
                    stageNum={activeStage}
                    apiBase={apiBase}
                    onReset={() => setStagePhases(prev => ({ ...prev, [activeStage]: "ready" }))}
                  />
                )}
              </div>
            )}

            {/* FAILED state */}
            {currentPhase === "failed" && (
              <>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-800">Stage {activeStage} failed</p>
                    {streamError && <p className="text-xs text-red-600 mt-1">{streamError}</p>}
                  </div>
                </div>
                <SourcesOnlyNotice />
                <SourcesPanel jobId={activeJob!.id} currentStage={activeStage} apiBase={apiBase} />
                <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => runStage(activeJob!.id, activeStage)}>
                  <RefreshCw className="h-4 w-4" />Try Again
                </Button>
              </>
            )}

            {/* DONE state */}
            {currentPhase === "done" && currentResult && (
              <DoneStageView
                stageNum={activeStage}
                result={currentResult}
                jobId={activeJob!.id}
                apiBase={apiBase}
                onSave={r => {
                  setStageResults(prev => ({ ...prev, [activeStage]: r }));
                  saveEdits.mutate({ stageNum: activeStage, result: r });
                }}
              />
            )}
          </div>

          {/* Bottom nav — only when done */}
          {currentPhase === "done" && (
            <div className="border-t px-6 py-4 flex items-center justify-between">
              {activeStage > 1 ? (
                <Button variant="outline" className="gap-2" onClick={() => setActiveStage(s => s - 1)}><ChevronLeft className="h-4 w-4" />Stage {activeStage - 1}</Button>
              ) : <div />}
              <Button
                className="gap-2 bg-green-600 hover:bg-green-700 px-6"
                onClick={() => approveStage(activeStage)}
                disabled={completeJob.isPending}
              >
                {completeJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {activeStage < 9 ? `Approve & Continue to Stage ${activeStage + 1}` : "Approve & Go to Publish"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
