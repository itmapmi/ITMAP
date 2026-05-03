import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  CheckCircle2, Circle, Loader2, AlertCircle, Wand2, Sparkles,
  ChevronRight, ChevronLeft, RefreshCw, Trash2, RotateCcw,
  ExternalLink, Eye, EyeOff, Building2, BarChart3, Grid3X3, Layers, Save,
  Plus, X, Globe, PencilLine,
} from "lucide-react";
import { LLMSelector, MODELS } from "./market-builder-llm-panel";
import { SourcesPanel } from "./market-builder-sources";

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
}

interface MarketBuilderStage {
  id: string; jobId: string; stage: number;
  status: "pending" | "running" | "completed" | "failed";
  result: any; error: string | null;
  startedAt: string | null; completedAt: string | null;
}

interface SSEEvent {
  type: string; stage?: number; label?: string; summary?: string;
  message?: string; result?: any; error?: string; jobId?: string;
}

const STAGE_META = [
  { num: 1, label: "Vendors",         icon: Building2, desc: "Identify key vendors in the market" },
  { num: 2, label: "Criteria",        icon: BarChart3,  desc: "Define evaluation criteria & weights" },
  { num: 3, label: "Feature Matrix",  icon: Grid3X3,    desc: "Build feature categories & features" },
  { num: 4, label: "Scoring",         icon: BarChart3,  desc: "Score vendors against criteria" },
  { num: 5, label: "Feature Support", icon: Layers,     desc: "Evaluate Harvey Ball support levels" },
];

const CATEGORIES = [
  "Cloud & Infrastructure","Security & Identity","Data & Analytics","AI & Machine Learning",
  "DevOps & Platform","Collaboration & Productivity","Storage & Backup","Networking",
  "Database","ERP & Business Applications","CRM & Marketing","Other",
];

// ── Step tracker ──────────────────────────────────────────────────────────

function StepTracker({ stages, activeStage, stageStatuses, onStepClick }: {
  stages: typeof STAGE_META;
  activeStage: number;
  stageStatuses: Record<number, string>;
  onStepClick: (n: number) => void;
}) {
  return (
    <div className="flex items-center">
      {stages.map((s, i) => {
        const status = stageStatuses[s.num] ?? "pending";
        const isActive = s.num === activeStage;
        const isDone = status === "completed";
        const isRunning = status === "running";
        const isClickable = isDone;
        return (
          <div key={s.num} className="flex items-center flex-1 min-w-0">
            <button
              onClick={() => isClickable && onStepClick(s.num)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 flex-1 min-w-0 transition-colors text-left ${
                isActive ? "bg-blue-50 border border-blue-200" :
                isDone ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
              }`}
            >
              <div className="shrink-0">
                {isDone ? <CheckCircle2 className="h-5 w-5 text-green-600" /> :
                 isRunning ? <Loader2 className="h-5 w-5 text-blue-600 animate-spin" /> :
                 <Circle className="h-5 w-5 text-gray-300" />}
              </div>
              <div className="min-w-0 hidden sm:block">
                <p className={`text-xs font-semibold truncate ${isActive ? "text-blue-800" : isDone ? "text-gray-700" : "text-gray-400"}`}>
                  {s.num}. {s.label}
                </p>
              </div>
            </button>
            {i < stages.length - 1 && <ChevronRight className="h-4 w-4 text-gray-300 shrink-0 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage editors ─────────────────────────────────────────────────────────

function Stage1Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const vendors = result?.vendors ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const startEdit = (i: number) => { setEditing(i); setDraft({ ...vendors[i] }); };
  const saveEdit = () => {
    const updated = vendors.map((v: any, i: number) => i === editing ? draft : v);
    onChange({ ...result, vendors: updated });
    setEditing(null); setDraft(null);
  };
  const removeVendor = (i: number) => onChange({ ...result, vendors: vendors.filter((_: any, j: number) => j !== i) });
  const addVendor = () => {
    onChange({ ...result, vendors: [...vendors, { name: "", product: "", website: "", description: "", newsroomUrl: "" }] });
    startEdit(vendors.length);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-600 mb-1">Market Summary</p>
        <Textarea value={result?.marketSummary ?? ""} onChange={e => onChange({ ...result, marketSummary: e.target.value })} rows={3} className="text-xs resize-none bg-white" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{vendors.length} Vendors</p>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addVendor}>
            <Plus className="h-3.5 w-3.5" /> Add Vendor
          </Button>
        </div>
        {vendors.map((v: any, i: number) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            {editing === i ? (
              <div className="space-y-2">
                {["name","product","website","newsroomUrl"].map(field => (
                  <div key={field} className="space-y-0.5">
                    <Label className="text-xs capitalize">{field === "newsroomUrl" ? "Newsroom URL" : field}</Label>
                    <Input value={draft?.[field] ?? ""} onChange={e => setDraft((d: any) => ({ ...d, [field]: e.target.value }))} className="h-7 text-xs" />
                  </div>
                ))}
                <div className="space-y-0.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea value={draft?.description ?? ""} onChange={e => setDraft((d: any) => ({ ...d, description: e.target.value }))} rows={2} className="text-xs resize-none" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={saveEdit}><Save className="h-3 w-3" /> Save</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{v.name} <span className="text-gray-400 font-normal">— {v.product}</span></p>
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
      </div>
    </div>
  );
}

function Stage2Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const criteria = result?.criteria ?? [];
  const update = (i: number, field: string, value: any) => {
    const updated = criteria.map((c: any, j: number) => j === i ? { ...c, [field]: value } : c);
    onChange({ ...result, criteria: updated });
  };
  const remove = (i: number) => onChange({ ...result, criteria: criteria.filter((_: any, j: number) => j !== i) });
  const add = (cat: string) => onChange({ ...result, criteria: [...criteria, { name: "", description: "", category: cat, weight: 20 }] });

  return (
    <div className="space-y-4">
      {["execution", "viability"].map(axis => (
        <div key={axis}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold capitalize text-gray-700">{axis} Axis</p>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => add(axis)}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {criteria.filter((c: any) => c.category === axis).map((c: any) => {
              const i = criteria.indexOf(c);
              return (
                <div key={i} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={c.name} onChange={e => update(i, "name", e.target.value)} placeholder="Criterion name" className="h-7 text-xs font-medium flex-1" />
                    <div className="flex items-center gap-1 shrink-0">
                      <Label className="text-xs text-gray-500 whitespace-nowrap">Weight</Label>
                      <Input type="number" min={0} max={100} value={c.weight} onChange={e => update(i, "weight", parseInt(e.target.value) || 0)} className="h-7 text-xs w-14 text-center" />
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(i)}><X className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                  <Textarea value={c.description} onChange={e => update(i, "description", e.target.value)} rows={2} placeholder="Description…" className="text-xs resize-none" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stage3Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const cats = result?.categories ?? [];
  const updateCat = (i: number, field: string, v: any) => onChange({ ...result, categories: cats.map((c: any, j: number) => j === i ? { ...c, [field]: v } : c) });
  const removeCat = (i: number) => onChange({ ...result, categories: cats.filter((_: any, j: number) => j !== i) });
  const addFeature = (ci: number) => updateCat(ci, "features", [...(cats[ci].features ?? []), { name: "", description: "" }]);
  const updateFeature = (ci: number, fi: number, field: string, v: string) => {
    const features = cats[ci].features.map((f: any, j: number) => j === fi ? { ...f, [field]: v } : f);
    updateCat(ci, "features", features);
  };
  const removeFeature = (ci: number, fi: number) => updateCat(ci, "features", cats[ci].features.filter((_: any, j: number) => j !== fi));

  return (
    <Accordion type="multiple" className="space-y-2">
      {cats.map((cat: any, ci: number) => (
        <AccordionItem key={ci} value={`cat-${ci}`} className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Input value={cat.name} onChange={e => { e.stopPropagation(); updateCat(ci, "name", e.target.value); }} onClick={e => e.stopPropagation()} className="h-7 text-sm font-medium flex-1 max-w-xs" />
              {cat.isEcosystem && <Badge variant="outline" className="text-purple-600 border-purple-200 text-xs py-0">Ecosystem</Badge>}
              <Badge variant="outline" className="text-gray-500 text-xs py-0 shrink-0">{cat.features?.length ?? 0} features</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-2">
            <Textarea value={cat.description} onChange={e => updateCat(ci, "description", e.target.value)} rows={2} placeholder="Category description…" className="text-xs resize-none" />
            <div className="flex flex-wrap gap-1.5">
              {(cat.features ?? []).map((f: any, fi: number) => (
                <div key={fi} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5 group">
                  <Input value={f.name} onChange={e => updateFeature(ci, fi, "name", e.target.value)} className="h-5 text-xs border-0 bg-transparent p-0 w-24 focus-visible:ring-0" />
                  <button onClick={() => removeFeature(ci, fi)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="h-6 text-xs rounded-full px-2 gap-0.5" onClick={() => addFeature(ci)}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-red-500 hover:text-red-700" onClick={() => removeCat(ci)}>
              <Trash2 className="h-3 w-3 mr-1" /> Remove Category
            </Button>
          </AccordionContent>
        </AccordionItem>
      ))}
      <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1" onClick={() => onChange({ ...result, categories: [...cats, { name: "New Category", description: "", isEcosystem: false, features: [] }] })}>
        <Plus className="h-3.5 w-3.5" /> Add Category
      </Button>
    </Accordion>
  );
}

function Stage4Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const scores = result?.scores ?? [];
  const vendors = [...new Set(scores.map((s: any) => s.vendorName))];
  const criteria = [...new Set(scores.map((s: any) => s.criterionName))];
  const [selected, setSelected] = useState<{ v: string; c: string } | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const getScore = (v: string, c: string) => scores.find((s: any) => s.vendorName === v && s.criterionName === c);
  const saveScore = () => {
    if (!selected) return;
    const updated = scores.map((s: any) =>
      s.vendorName === selected.v && s.criterionName === selected.c
        ? { ...s, score: parseFloat(editScore) || s.score, notes: editNotes }
        : s
    );
    onChange({ ...result, scores: updated });
    setSelected(null);
  };

  const scoreColor = (s: number) =>
    s >= 8 ? "bg-green-100 text-green-800" :
    s >= 6 ? "bg-blue-100 text-blue-800" :
    s >= 4 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

  return (
    <div className="space-y-3">
      {selected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.c}</p>
          <div className="flex gap-2">
            <div className="w-20">
              <Label className="text-xs">Score (0–10)</Label>
              <Input type="number" min={0} max={10} step={0.1} value={editScore} onChange={e => setEditScore(e.target.value)} className="h-7 text-xs text-center" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} className="text-xs resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={saveScore}><Save className="h-3 w-3 mr-1" /> Save</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left p-2 font-semibold text-gray-600 whitespace-nowrap w-32">Vendor</th>
              {criteria.map(c => <th key={c as string} className="p-2 font-semibold text-gray-600 text-center whitespace-nowrap max-w-20 truncate">{c as string}</th>)}
            </tr>
          </thead>
          <tbody>
            {vendors.map(v => (
              <tr key={v as string} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2 font-medium text-gray-800 whitespace-nowrap">{v as string}</td>
                {criteria.map(c => {
                  const s = getScore(v, c);
                  return (
                    <td key={c as string} className="p-1 text-center">
                      <button
                        onClick={() => { setSelected({ v: v as string, c: c as string }); setEditScore(s?.score?.toString() ?? ""); setEditNotes(s?.notes ?? ""); }}
                        className={`rounded px-2 py-0.5 text-xs font-mono font-semibold hover:ring-2 hover:ring-blue-300 transition-all ${scoreColor(s?.score ?? 0)}`}
                        title={s?.notes}
                      >
                        {s?.score?.toFixed(1) ?? "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Click any score to edit it and its justification notes.</p>
    </div>
  );
}

function Stage5Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const support = result?.support ?? [];
  const vendors = [...new Set(support.map((s: any) => s.vendorName))];
  const features = [...new Set(support.map((s: any) => s.featureName))];
  const [selected, setSelected] = useState<{ v: string; f: string } | null>(null);
  const [editLevel, setEditLevel] = useState(0);
  const [editComments, setEditComments] = useState("");

  const HARVEY = ["✕ None","◔ Limited","◑ Partial","◕ Good","● Full"];
  const getSupport = (v: string, f: string) => support.find((s: any) => s.vendorName === v && s.featureName === f);
  const saveSupport = () => {
    if (!selected) return;
    const updated = support.map((s: any) =>
      s.vendorName === selected.v && s.featureName === selected.f
        ? { ...s, supportLevel: editLevel, comments: editComments }
        : s
    );
    onChange({ ...result, support: updated });
    setSelected(null);
  };

  const levelColor = (l: number) => ["text-gray-300","text-red-400","text-yellow-500","text-blue-500","text-green-600"][l] ?? "";

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{support.length} support records across {vendors.length} vendors and {features.length} features. Click any cell to edit.</p>
      {selected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.f}</p>
          <div className="space-y-1">
            <Label className="text-xs">Support Level</Label>
            <div className="flex gap-1.5">
              {HARVEY.map((h, l) => (
                <button key={l} onClick={() => setEditLevel(l)} className={`text-xs px-2 py-1 rounded border transition-all ${editLevel === l ? "border-blue-500 bg-blue-100 font-semibold" : "border-gray-200 hover:border-gray-300"}`}>{h}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Comments</Label>
            <Textarea value={editComments} onChange={e => setEditComments(e.target.value)} rows={2} className="text-xs resize-none mt-1" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={saveSupport}><Save className="h-3 w-3 mr-1" /> Save</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-80">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b">
              <th className="text-left p-2 font-semibold text-gray-600 whitespace-nowrap w-28">Vendor</th>
              {features.slice(0, 20).map(f => <th key={f as string} className="p-1.5 font-semibold text-gray-600 text-center whitespace-nowrap max-w-16 truncate" title={f as string}>{(f as string).slice(0, 12)}</th>)}
              {features.length > 20 && <th className="p-1.5 text-gray-400">+{features.length - 20}</th>}
            </tr>
          </thead>
          <tbody>
            {vendors.map(v => (
              <tr key={v as string} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2 font-medium text-gray-800 whitespace-nowrap">{v as string}</td>
                {features.slice(0, 20).map(f => {
                  const s = getSupport(v, f);
                  return (
                    <td key={f as string} className="p-1 text-center">
                      <button
                        onClick={() => { setSelected({ v: v as string, f: f as string }); setEditLevel(s?.supportLevel ?? 0); setEditComments(s?.comments ?? ""); }}
                        className={`text-base hover:scale-110 transition-transform ${levelColor(s?.supportLevel ?? 0)}`}
                        title={s?.comments}
                      >
                        {HARVEY[s?.supportLevel ?? 0]?.split(" ")[0] ?? "✕"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Stage panel ───────────────────────────────────────────────────────────

function StagePanel({ stageNum, stageResult, stageStatus, jobId, onResultChange, onRegenerate, isRegenerating }: {
  stageNum: number; stageResult: any; stageStatus: string; jobId: string;
  onResultChange: (r: any) => void; onRegenerate: () => void; isRegenerating: boolean;
}) {
  const { toast } = useToast();
  const [localResult, setLocalResult] = useState(stageResult);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => { setLocalResult(stageResult); setIsDirty(false); }, [stageResult]);

  const handleChange = (r: any) => { setLocalResult(r); setIsDirty(true); };

  const saveEdits = useMutation({
    mutationFn: () =>
      apiRequest(`/api/admin/market-builder/jobs/${jobId}/stages/${stageNum}/result`, "PATCH", localResult).then(r => r.json()),
    onSuccess: () => { onResultChange(localResult); setIsDirty(false); toast({ title: `Stage ${stageNum} edits saved` }); },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const meta = STAGE_META.find(s => s.num === stageNum)!;
  const isDone = stageStatus === "completed";

  return (
    <div className="space-y-4">
      {/* Stage header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Stage {stageNum}: {meta.label}</h3>
          <p className="text-sm text-gray-500">{meta.desc}</p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button size="sm" className="h-8 text-xs gap-1 bg-amber-600 hover:bg-amber-700" onClick={() => saveEdits.mutate()} disabled={saveEdits.isPending}>
              {saveEdits.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Edits
            </Button>
          )}
          {isDone && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={onRegenerate} disabled={isRegenerating}>
              {isRegenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Regenerate
            </Button>
          )}
        </div>
      </div>

      {/* Two-column: sources left, results right */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        <SourcesPanel jobId={jobId} currentStage={stageNum} />

        <div className="min-w-0">
          {stageStatus === "running" && (
            <div className="flex items-center gap-3 text-sm text-blue-600 py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
              AI is working on this stage…
            </div>
          )}
          {stageStatus === "failed" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-4">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Stage failed</p>
                <p className="text-xs text-red-600 mt-0.5">Click Regenerate to retry this stage.</p>
              </div>
            </div>
          )}
          {isDone && localResult && (
            <>
              {stageNum === 1 && <Stage1Editor result={localResult} onChange={handleChange} />}
              {stageNum === 2 && <Stage2Editor result={localResult} onChange={handleChange} />}
              {stageNum === 3 && <Stage3Editor result={localResult} onChange={handleChange} />}
              {stageNum === 4 && <Stage4Editor result={localResult} onChange={handleChange} />}
              {stageNum === 5 && <Stage5Editor result={localResult} onChange={handleChange} />}
            </>
          )}
          {stageStatus === "pending" && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 space-y-2">
              <Circle className="h-8 w-8" />
              <p className="text-sm">This stage hasn't run yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Publish panel ─────────────────────────────────────────────────────────

function PublishPanel({ job, stageResults, onPublished }: {
  job: MarketBuilderJob; stageResults: Record<number, any>;
  onPublished: (marketId: string, isVisible: boolean) => void;
}) {
  const { toast } = useToast();
  const [isVisible, setIsVisible] = useState(false);
  const stage1 = stageResults[1];
  const stage2 = stageResults[2];
  const stage3 = stageResults[3];
  const stage4 = stageResults[4];
  const stage5 = stageResults[5];
  const featureCount = stage3?.categories?.reduce((s: number, c: any) => s + c.features.length, 0) ?? 0;

  const publish = useMutation({
    mutationFn: () =>
      apiRequest(`/api/admin/market-builder/jobs/${job.id}/publish`, "POST", { isVisible }).then(r => r.json()),
    onSuccess: (data: any) => {
      onPublished(data.marketId, isVisible);
      toast({ title: "Market published!", description: isVisible ? "Market is now visible." : "Market created (hidden). Make it visible from the Markets tab." });
    },
    onError: (err: any) => toast({ title: "Publish failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border-2 border-green-200 bg-green-50 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-green-900">Ready to Publish</h3>
        <p className="text-sm text-green-700 mt-0.5">Review the summary below, then publish to create the market.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Vendors", value: stage1?.vendors?.length ?? 0 },
          { label: "Criteria", value: stage2?.criteria?.length ?? 0 },
          { label: "Features", value: featureCount },
          { label: "Scores", value: stage4?.scores?.length ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-white border border-green-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-800">{value}</p>
            <p className="text-xs text-green-600">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4">
        <Switch checked={isVisible} onCheckedChange={setIsVisible} />
        <div>
          <p className="text-sm font-medium text-gray-800">Make market visible immediately</p>
          <p className="text-xs text-gray-500">If off, the market is created but hidden — you can enable it from the Markets admin tab.</p>
        </div>
      </div>

      <Button
        className="w-full gap-2 bg-green-700 hover:bg-green-800 h-10"
        onClick={() => publish.mutate()}
        disabled={publish.isPending}
      >
        {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Publish Market
      </Button>
    </div>
  );
}

// ── Previous jobs ─────────────────────────────────────────────────────────

function PreviousJobs({ jobs, onResume, onDelete }: {
  jobs: MarketBuilderJob[];
  onResume: (j: MarketBuilderJob) => void;
  onDelete: (id: string) => void;
}) {
  if (jobs.length === 0) return null;
  const statusBadge = (s: string) => ({
    completed: "text-green-700 border-green-300 bg-green-50",
    published: "text-blue-700 border-blue-300 bg-blue-50",
    running:   "text-amber-700 border-amber-300 bg-amber-50",
    failed:    "text-red-700 border-red-300 bg-red-50",
    idle:      "text-gray-600 border-gray-300",
  }[s] ?? "text-gray-600 border-gray-300");

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Previous Jobs</p>
      {jobs.map(j => (
        <div key={j.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">{j.inputName}</span>
              <Badge variant="outline" className={`text-xs py-0 ${statusBadge(j.status)}`}>{j.status}</Badge>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(j.createdAt).toLocaleDateString()} · {j.llmProvider}/{j.llmModel}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {j.status === "published" && j.marketId && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => window.open(`/markets/${j.marketId}`, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            {j.status !== "published" && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-600" onClick={() => onResume(j)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resume
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onDelete(j.id)}>
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────

type WizardView = "setup" | "running" | "review" | "published";

export function MarketBuilderWizard() {
  const { toast } = useToast();

  // Form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4.1-mini");

  // Wizard state
  const [view, setView] = useState<WizardView>("setup");
  const [activeJob, setActiveJob] = useState<MarketBuilderJob | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  // Stage data
  const [stageResults, setStageResults] = useState<Record<number, any>>({});
  const [stageStatuses, setStageStatuses] = useState<Record<number, string>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [regenStage, setRegenStage] = useState<number | null>(null);

  // Published
  const [publishedMarketId, setPublishedMarketId] = useState<string | null>(null);
  const [publishedVisible, setPublishedVisible] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: jobs = [], refetch: refetchJobs } = useQuery<MarketBuilderJob[]>({
    queryKey: ["/api/admin/market-builder/jobs"],
  });

  // ── SSE stream ────────────────────────────────────────────────────────

  const startStream = useCallback((jobId: string, singleStage?: number) => {
    eventSourceRef.current?.close();
    const url = singleStage != null
      ? `/api/admin/market-builder/jobs/${jobId}/stages/${singleStage}/regenerate`
      : `/api/admin/market-builder/jobs/${jobId}/stream`;

    // Note: EventSource only supports GET. For regenerate (POST) we use SSE via GET stream after reset.
    // The regenerate route is a POST that returns SSE — we use fetch for that.
    if (singleStage != null) {
      // Use fetch for POST SSE
      fetch(url, { method: "POST", credentials: "include" }).then(async res => {
        if (!res.ok) { setStreamError(`Regenerate failed: ${res.status}`); return; }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try { handleSSEEvent(JSON.parse(line.slice(6))); } catch (_) {}
            }
          }
        }
        setRegenStage(null);
        refetchJobs();
      }).catch(err => { setStreamError(err.message); setRegenStage(null); });
      return;
    }

    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = e => { try { handleSSEEvent(JSON.parse(e.data)); } catch (_) {} };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStreamError("Connection lost. You can resume from the previous jobs list.");
      es.close(); refetchJobs();
    };
  }, [refetchJobs]);

  const handleSSEEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "job_start":
        setActiveStep(1);
        break;
      case "stage_start":
        setActiveStep(event.stage!);
        setStageStatuses(prev => ({ ...prev, [event.stage!]: "running" }));
        setProgressMsg("");
        break;
      case "stage_progress":
        setProgressMsg(event.message ?? "");
        break;
      case "stage_complete":
      case "stage_skipped":
        setStageResults(prev => ({ ...prev, [event.stage!]: event.result }));
        setStageStatuses(prev => ({ ...prev, [event.stage!]: "completed" }));
        setActiveStep(prev => Math.max(prev, event.stage! + 1));
        setProgressMsg("");
        break;
      case "stage_error":
        setStageStatuses(prev => ({ ...prev, [event.stage!]: "failed" }));
        setStreamError(`Stage ${event.stage} failed: ${event.error}`);
        break;
      case "job_complete":
        setView("review");
        setActiveStep(1);
        eventSourceRef.current?.close();
        refetchJobs();
        break;
      case "job_error":
        setStreamError(event.error ?? "Unknown error");
        eventSourceRef.current?.close();
        refetchJobs();
        break;
    }
  };

  useEffect(() => {
    if (view === "running" && activeJob) startStream(activeJob.id);
    return () => { eventSourceRef.current?.close(); };
  }, [view, activeJob, startStream]);

  // ── Mutations ─────────────────────────────────────────────────────────

  const createJob = useMutation({
    mutationFn: (data: any) =>
      apiRequest("/api/admin/market-builder/jobs", "POST", data).then(r => r.json()),
    onSuccess: (job: MarketBuilderJob) => {
      setActiveJob(job);
      setView("running");
      setActiveStep(1);
      setStageResults({}); setStageStatuses({}); setStreamError(null); setProgressMsg("");
      refetchJobs();
    },
    onError: (err: any) => toast({ title: "Failed to create job", description: err.message, variant: "destructive" }),
  });

  const deleteJob = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/market-builder/jobs/${id}`, "DELETE"),
    onSuccess: () => refetchJobs(),
  });

  const updateVisibility = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      apiRequest(`/api/admin/market-builder/jobs/${id}/visibility`, "PATCH", { isVisible }).then(r => r.json()),
    onSuccess: (_, { isVisible }) => {
      setPublishedVisible(isVisible);
      toast({ title: isVisible ? "Market is now visible" : "Market is now hidden" });
    },
  });

  const handleSubmit = () => {
    if (!name.trim() || !description.trim()) {
      toast({ title: "Please fill in the market name and description", variant: "destructive" });
      return;
    }
    createJob.mutate({
      inputName: name.trim(), inputDescription: description.trim(),
      inputCategory: category || undefined, inputContext: context.trim() || undefined,
      llmProvider: provider, llmModel: model,
    });
  };

  const handleResume = (job: MarketBuilderJob) => {
    setActiveJob(job);
    // Restore any existing stage results
    if (job.stages) {
      const results: Record<number, any> = {};
      const statuses: Record<number, string> = {};
      job.stages.forEach(s => { if (s.result) results[s.stage] = s.result; statuses[s.stage] = s.status; });
      setStageResults(results); setStageStatuses(statuses);
      const allDone = [1,2,3,4,5].every(n => statuses[n] === "completed");
      if (allDone) { setView("review"); setActiveStep(1); }
      else { setView("running"); }
    } else {
      setStageResults({}); setStageStatuses({}); setView("running");
    }
    setStreamError(null); setProgressMsg("");
  };

  const handleRegen = (stage: number) => {
    if (!activeJob) return;
    setRegenStage(stage);
    setStageStatuses(prev => ({ ...prev, [stage]: "running" }));
    setStreamError(null);
    startStream(activeJob.id, stage);
  };

  const allComplete = [1,2,3,4,5].every(n => stageStatuses[n] === "completed");
  const prevJobs = jobs.filter(j => j.id !== activeJob?.id);

  // ── Render ────────────────────────────────────────────────────────────

  if (view === "setup") {
    return (
      <div className="space-y-6 max-w-4xl">
        {/* Header + LLM selector */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-blue-600" /> AI Market Builder
              <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs ml-1">Beta</Badge>
            </h1>
            <p className="text-sm text-gray-500 mt-1">Describe a technology market and AI generates the full evaluation — vendors, criteria, features, scores and support.</p>
          </div>
          <LLMSelector provider={provider} model={model} onProviderChange={setProvider} onModelChange={setModel} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-800">Market Details</h2>
            <div className="space-y-1.5">
              <Label className="text-xs">Market Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Enterprise Object Storage" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description *</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What technology does it cover? Who are the buyers? What problem does it solve?" rows={4} className="resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Extra context <span className="text-gray-400">(optional)</span></Label>
              <Textarea value={context} onChange={e => setContext(e.target.value)} placeholder="Specific vendors to include, regional focus, buyer segment…" rows={2} className="resize-none" />
            </div>
            <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700 h-10" onClick={handleSubmit} disabled={createJob.isPending}>
              {createJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Start Building
            </Button>
          </div>

          {/* How it works */}
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <p className="font-semibold text-blue-900 mb-2">How it works</p>
              <ol className="space-y-2">
                {STAGE_META.map(s => (
                  <li key={s.num} className="flex items-start gap-2 text-sm text-blue-800">
                    <span className="font-bold shrink-0">{s.num}.</span>
                    <div>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-blue-600"> — {s.desc}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-blue-600 mt-3">Progress saves after every stage. Closing the browser is safe — resume anytime.</p>
            </div>
            <PreviousJobs jobs={prevJobs} onResume={handleResume} onDelete={id => deleteJob.mutate(id)} />
          </div>
        </div>
      </div>
    );
  }

  if (view === "published") {
    return (
      <div className="max-w-lg space-y-6">
        <div className="rounded-xl border-2 border-green-200 bg-green-50 p-8 text-center space-y-4">
          <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />
          <div>
            <h2 className="text-xl font-bold text-green-900">Market Created!</h2>
            <p className="text-sm text-green-700 mt-1">{activeJob?.inputName}</p>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4 text-left">
            <Switch
              checked={publishedVisible}
              onCheckedChange={v => { if (activeJob) updateVisibility.mutate({ id: activeJob.id, isVisible: v }); }}
              disabled={updateVisibility.isPending}
            />
            <div>
              <p className="text-sm font-medium text-gray-800">
                {publishedVisible ? <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-green-600" /> Visible to users</span>
                  : <span className="flex items-center gap-1"><EyeOff className="h-3.5 w-3.5 text-gray-400" /> Hidden (draft)</span>}
              </p>
              <p className="text-xs text-gray-500">Toggle visibility without leaving this page.</p>
            </div>
          </div>

          <div className="flex gap-3">
            {publishedMarketId && (
              <Button variant="outline" className="flex-1 gap-2 text-sm" onClick={() => window.open(`/markets/${publishedMarketId}`, "_blank")}>
                <ExternalLink className="h-4 w-4" /> Preview Market
              </Button>
            )}
            <Button className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-sm" onClick={() => {
              setView("setup"); setActiveJob(null);
              setName(""); setDescription(""); setCategory(""); setContext("");
              setPublishedMarketId(null); setStageResults({}); setStageStatuses({});
            }}>
              <Wand2 className="h-4 w-4" /> Build Another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Running + Review ──────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{activeJob?.inputName}</h1>
          <p className="text-xs text-gray-500">{activeJob?.llmProvider} / {activeJob?.llmModel}</p>
        </div>
        <div className="flex items-center gap-2">
          {view === "running" && (
            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Running
            </Badge>
          )}
          {view === "review" && (
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Ready to review
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { eventSourceRef.current?.close(); setView("setup"); }}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
        </div>
      </div>

      {/* Step tracker */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <StepTracker
          stages={STAGE_META}
          activeStage={activeStep}
          stageStatuses={stageStatuses}
          onStepClick={n => { if (view === "review") setActiveStep(n); }}
        />
      </div>

      {/* Running: current stage progress */}
      {view === "running" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-800">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span className="font-medium text-sm">
              {STAGE_META.find(s => s.num === activeStep)?.desc ?? "Processing…"}
            </span>
          </div>
          {progressMsg && <p className="text-xs text-amber-700 pl-6">{progressMsg}</p>}
          {streamError && (
            <div className="flex items-start gap-2 mt-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-red-700">{streamError}</p>
                <Button size="sm" variant="outline" className="h-7 text-xs mt-2 gap-1" onClick={() => { setStreamError(null); if (activeJob) startStream(activeJob.id); }}>
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Review: per-step content + nav */}
      {view === "review" && (
        <>
          {/* Stage content */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <StagePanel
              stageNum={activeStep}
              stageResult={stageResults[activeStep]}
              stageStatus={stageStatuses[activeStep] ?? "pending"}
              jobId={activeJob!.id}
              onResultChange={r => setStageResults(prev => ({ ...prev, [activeStep]: r }))}
              onRegenerate={() => handleRegen(activeStep)}
              isRegenerating={regenStage === activeStep}
            />
          </div>

          {/* Step nav */}
          <div className="flex items-center justify-between">
            <Button variant="outline" className="gap-2" onClick={() => setActiveStep(s => Math.max(1, s - 1))} disabled={activeStep === 1}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="text-xs text-gray-400">Step {activeStep} of 5</span>
            {activeStep < 5
              ? <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => setActiveStep(s => Math.min(5, s + 1))}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              : <Button className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => setActiveStep(6)}>
                  Review & Publish <CheckCircle2 className="h-4 w-4" />
                </Button>
            }
          </div>

          {/* Publish panel (step 6) */}
          {activeStep === 6 && allComplete && (
            <PublishPanel
              job={activeJob!}
              stageResults={stageResults}
              onPublished={(marketId, isVisible) => {
                setPublishedMarketId(marketId);
                setPublishedVisible(isVisible);
                setView("published");
                refetchJobs();
              }}
            />
          )}
        </>
      )}

      {/* Completed stages preview while running */}
      {view === "running" && Object.keys(stageResults).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Completed stages</p>
          {Object.entries(stageResults).map(([num, result]) => {
            const n = parseInt(num);
            const meta = STAGE_META.find(s => s.num === n)!;
            const summary = n === 1 ? `${result?.vendors?.length ?? 0} vendors`
              : n === 2 ? `${result?.criteria?.length ?? 0} criteria`
              : n === 3 ? `${result?.categories?.length ?? 0} categories, ${result?.categories?.reduce((s: number, c: any) => s + c.features.length, 0)} features`
              : n === 4 ? `${result?.scores?.length ?? 0} scores`
              : `${result?.support?.length ?? 0} records`;
            return (
              <div key={n} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <span className="font-medium text-gray-700">Stage {n}: {meta.label}</span>
                <span className="text-gray-400">— {summary}</span>
              </div>
            );
          })}
        </div>
      )}

      <PreviousJobs jobs={prevJobs} onResume={handleResume} onDelete={id => deleteJob.mutate(id)} />
    </div>
  );
}
