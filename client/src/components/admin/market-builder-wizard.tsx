import { useState, useEffect, useRef } from "react";
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
  CheckCircle2, Circle, Loader2, AlertCircle, Wand2, Sparkles, Lock,
  ChevronRight, ChevronLeft, RefreshCw, Trash2, RotateCcw,
  ExternalLink, Eye, EyeOff, Building2, BarChart3, Grid3X3, Layers, Save,
  Plus, X, Globe, PencilLine, PlayCircle, FileSearch,
} from "lucide-react";
import { LLMSelector } from "./market-builder-llm-panel";
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
}

type StagePhase = "ready" | "running" | "done" | "failed";

const STAGE_META = [
  { num: 1, label: "Vendors",         icon: Building2, desc: "AI identifies key vendors and products in the market.", what: "A list of 8–15 vendors with names, product descriptions, websites, and newsroom URLs." },
  { num: 2, label: "Criteria",        icon: BarChart3,  desc: "AI defines evaluation criteria split across Execution and Viability axes.", what: "7–9 weighted criteria used to position vendors on the chart." },
  { num: 3, label: "Feature Matrix",  icon: Grid3X3,    desc: "AI builds a product capability matrix with feature categories.", what: "Feature categories and individual features (60–100 total) to evaluate across all vendors." },
  { num: 4, label: "Scoring",         icon: BarChart3,  desc: "AI scores each vendor against every criterion with justification.", what: "A score 0–10 for each vendor × criterion, with evidence-based notes." },
  { num: 5, label: "Feature Support", icon: Layers,     desc: "AI rates each vendor's support level for every feature (Harvey Ball).", what: "0–4 Harvey Ball ratings for every vendor × feature combination, with commentary." },
];

const CATEGORIES = [
  "Cloud & Infrastructure","Security & Identity","Data & Analytics","AI & Machine Learning",
  "DevOps & Platform","Collaboration & Productivity","Storage & Backup","Networking",
  "Database","ERP & Business Applications","CRM & Marketing","Other",
];

// ── Step tracker ──────────────────────────────────────────────────────────

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
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg flex-1 min-w-0 text-left transition-all ${
                isActive
                  ? "bg-blue-50 border-2 border-blue-300"
                  : isDone
                  ? "hover:bg-gray-50 cursor-pointer border border-transparent"
                  : "cursor-default border border-transparent"
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
                  isActive ? "text-blue-800" :
                  isDone   ? "text-gray-700" : "text-gray-400"
                }`}>
                  {s.num}. {s.label}
                </p>
              </div>
            </button>
            {i < STAGE_META.length - 1 && (
              <ChevronRight className="h-4 w-4 text-gray-200 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage result editors ──────────────────────────────────────────────────

function Stage1Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const vendors = result?.vendors ?? [];
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
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-gray-600">Market Summary</Label>
        <Textarea value={result?.marketSummary ?? ""} onChange={e => onChange({ ...result, marketSummary: e.target.value })} rows={3} className="text-xs resize-none" />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{vendors.length} Vendors</p>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addVendor}>
          <Plus className="h-3.5 w-3.5" /> Add Vendor
        </Button>
      </div>
      {vendors.map((v: any, i: number) => (
        <div key={i} className="rounded-lg border bg-white p-3">
          {editing === i ? (
            <div className="space-y-2">
              {["name","product","website","newsroomUrl"].map(field => (
                <div key={field}>
                  <Label className="text-xs capitalize">{field === "newsroomUrl" ? "Newsroom URL" : field}</Label>
                  <Input value={draft?.[field] ?? ""} onChange={e => setDraft((d: any) => ({ ...d, [field]: e.target.value }))} className="h-7 text-xs mt-0.5" />
                </div>
              ))}
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={draft?.description ?? ""} onChange={e => setDraft((d: any) => ({ ...d, description: e.target.value }))} rows={2} className="text-xs resize-none mt-0.5" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveEdit}><Save className="h-3 w-3 mr-1" />Save</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button>
              </div>
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
    </div>
  );
}

function Stage2Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const criteria = result?.criteria ?? [];
  const update = (i: number, field: string, value: any) =>
    onChange({ ...result, criteria: criteria.map((c: any, j: number) => j === i ? { ...c, [field]: value } : c) });
  const remove = (i: number) => onChange({ ...result, criteria: criteria.filter((_: any, j: number) => j !== i) });
  const add = (cat: string) => onChange({ ...result, criteria: [...criteria, { name: "", description: "", category: cat, weight: 20 }] });
  return (
    <div className="space-y-4">
      {["execution","viability"].map(axis => (
        <div key={axis}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold capitalize text-gray-700">{axis} Axis</p>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => add(axis)}><Plus className="h-3.5 w-3.5" />Add</Button>
          </div>
          {criteria.filter((c: any) => c.category === axis).map((c: any) => {
            const i = criteria.indexOf(c);
            return (
              <div key={i} className="rounded-lg border bg-white p-3 mb-2 space-y-2">
                <div className="flex gap-2 items-center">
                  <Input value={c.name} onChange={e => update(i, "name", e.target.value)} placeholder="Criterion name" className="h-7 text-xs flex-1" />
                  <Label className="text-xs text-gray-500 shrink-0">Weight</Label>
                  <Input type="number" min={0} max={100} value={c.weight} onChange={e => update(i, "weight", parseInt(e.target.value)||0)} className="h-7 text-xs w-14 text-center" />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}><X className="h-3.5 w-3.5 text-red-400" /></Button>
                </div>
                <Textarea value={c.description} onChange={e => update(i, "description", e.target.value)} rows={2} placeholder="Description…" className="text-xs resize-none" />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Stage3Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const cats = result?.categories ?? [];
  const updateCat = (i: number, field: string, v: any) =>
    onChange({ ...result, categories: cats.map((c: any, j: number) => j === i ? { ...c, [field]: v } : c) });
  const addFeature = (ci: number) => updateCat(ci, "features", [...(cats[ci].features??[]), { name: "", description: "" }]);
  const updateFeature = (ci: number, fi: number, field: string, v: string) =>
    updateCat(ci, "features", cats[ci].features.map((f: any, j: number) => j === fi ? { ...f, [field]: v } : f));
  const removeFeature = (ci: number, fi: number) =>
    updateCat(ci, "features", cats[ci].features.filter((_: any, j: number) => j !== fi));
  return (
    <Accordion type="multiple" className="space-y-2">
      {cats.map((cat: any, ci: number) => (
        <AccordionItem key={ci} value={`cat-${ci}`} className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm py-3 hover:no-underline">
            <div className="flex items-center gap-2 flex-1">
              <Input value={cat.name} onChange={e => { e.stopPropagation(); updateCat(ci, "name", e.target.value); }} onClick={e => e.stopPropagation()} className="h-7 text-sm flex-1 max-w-xs" />
              {cat.isEcosystem && <Badge variant="outline" className="text-purple-600 border-purple-200 text-xs">Ecosystem</Badge>}
              <Badge variant="outline" className="text-gray-400 text-xs">{cat.features?.length ?? 0}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-2">
            <Textarea value={cat.description} onChange={e => updateCat(ci, "description", e.target.value)} rows={2} className="text-xs resize-none" />
            <div className="flex flex-wrap gap-1.5">
              {(cat.features ?? []).map((f: any, fi: number) => (
                <div key={fi} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5 group">
                  <Input value={f.name} onChange={e => updateFeature(ci, fi, "name", e.target.value)} className="h-5 text-xs border-0 bg-transparent p-0 w-24 focus-visible:ring-0" />
                  <button onClick={() => removeFeature(ci, fi)} className="opacity-0 group-hover:opacity-100 text-red-400"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="h-6 text-xs rounded-full px-2" onClick={() => addFeature(ci)}>
                <Plus className="h-3 w-3 mr-0.5" />Add
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() =>
        onChange({ ...result, categories: [...cats, { name: "New Category", description: "", isEcosystem: false, features: [] }] })}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Category
      </Button>
    </Accordion>
  );
}

function Stage4Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const scores = result?.scores ?? [];
  const vendors = [...new Set<string>(scores.map((s: any) => s.vendorName))];
  const criteria = [...new Set<string>(scores.map((s: any) => s.criterionName))];
  const [selected, setSelected] = useState<{ v: string; c: string } | null>(null);
  const [editScore, setEditScore] = useState(""); const [editNotes, setEditNotes] = useState("");
  const getScore = (v: string, c: string) => scores.find((s: any) => s.vendorName === v && s.criterionName === c);
  const saveScore = () => {
    if (!selected) return;
    onChange({ ...result, scores: scores.map((s: any) => s.vendorName === selected.v && s.criterionName === selected.c ? { ...s, score: parseFloat(editScore)||s.score, notes: editNotes } : s) });
    setSelected(null);
  };
  const color = (s: number) => s>=8?"bg-green-100 text-green-800":s>=6?"bg-blue-100 text-blue-800":s>=4?"bg-yellow-100 text-yellow-800":"bg-red-100 text-red-800";
  return (
    <div className="space-y-3">
      {selected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.c}</p>
          <div className="flex gap-2">
            <div className="w-20"><Label className="text-xs">Score (0–10)</Label><Input type="number" min={0} max={10} step={0.1} value={editScore} onChange={e=>setEditScore(e.target.value)} className="h-7 text-xs text-center mt-0.5" /></div>
            <div className="flex-1"><Label className="text-xs">Notes</Label><Textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} rows={2} className="text-xs resize-none mt-0.5" /></div>
          </div>
          <div className="flex gap-2"><Button size="sm" className="h-7 text-xs" onClick={saveScore}><Save className="h-3 w-3 mr-1"/>Save</Button><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={()=>setSelected(null)}>Cancel</Button></div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border text-xs">
        <table className="w-full">
          <thead><tr className="bg-gray-50 border-b"><th className="text-left p-2 text-gray-600 w-32">Vendor</th>{criteria.map(c=><th key={c} className="p-2 text-gray-600 text-center whitespace-nowrap max-w-20 truncate" title={c}>{c}</th>)}</tr></thead>
          <tbody>{vendors.map(v=>(
            <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
              <td className="p-2 font-medium whitespace-nowrap">{v}</td>
              {criteria.map(c=>{const s=getScore(v,c);return(
                <td key={c} className="p-1 text-center">
                  <button onClick={()=>{setSelected({v,c});setEditScore(s?.score?.toString()??"");setEditNotes(s?.notes??"");}} className={`rounded px-2 py-0.5 text-xs font-mono font-semibold hover:ring-2 hover:ring-blue-300 ${color(s?.score??0)}`} title={s?.notes}>{s?.score?.toFixed(1)??"–"}</button>
                </td>
              );})}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Click any score cell to edit.</p>
    </div>
  );
}

function Stage5Editor({ result, onChange }: { result: any; onChange: (r: any) => void }) {
  const support = result?.support ?? [];
  const vendors = [...new Set<string>(support.map((s: any) => s.vendorName))];
  const features = [...new Set<string>(support.map((s: any) => s.featureName))];
  const [selected, setSelected] = useState<{ v: string; f: string }|null>(null);
  const [editLevel, setEditLevel] = useState(0); const [editComments, setEditComments] = useState("");
  const HARVEY = ["✕ None","◔ Limited","◑ Partial","◕ Good","● Full"];
  const get = (v: string, f: string) => support.find((s: any) => s.vendorName===v && s.featureName===f);
  const save = () => {
    if(!selected) return;
    onChange({...result, support: support.map((s: any) => s.vendorName===selected.v&&s.featureName===selected.f?{...s,supportLevel:editLevel,comments:editComments}:s)});
    setSelected(null);
  };
  const lcolor = (l: number) => ["text-gray-300","text-red-400","text-yellow-500","text-blue-500","text-green-600"][l]??"";
  return (
    <div className="space-y-3">
      {selected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">{selected.v} × {selected.f}</p>
          <div className="flex gap-1.5 flex-wrap">{HARVEY.map((h,l)=><button key={l} onClick={()=>setEditLevel(l)} className={`text-xs px-2 py-1 rounded border ${editLevel===l?"border-blue-500 bg-blue-100 font-semibold":"border-gray-200"}`}>{h}</button>)}</div>
          <Textarea value={editComments} onChange={e=>setEditComments(e.target.value)} rows={2} className="text-xs resize-none" placeholder="Comments…" />
          <div className="flex gap-2"><Button size="sm" className="h-7 text-xs" onClick={save}><Save className="h-3 w-3 mr-1"/>Save</Button><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={()=>setSelected(null)}>Cancel</Button></div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border max-h-72">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50"><tr className="border-b"><th className="text-left p-2 text-gray-600 w-28">Vendor</th>{features.slice(0,20).map(f=><th key={f} className="p-1.5 text-gray-600 text-center whitespace-nowrap max-w-16 truncate" title={f}>{f.slice(0,12)}</th>)}{features.length>20&&<th className="p-1.5 text-gray-400">+{features.length-20}</th>}</tr></thead>
          <tbody>{vendors.map(v=>(
            <tr key={v} className="border-b last:border-0 hover:bg-gray-50">
              <td className="p-2 font-medium whitespace-nowrap">{v}</td>
              {features.slice(0,20).map(f=>{const s=get(v,f);return(
                <td key={f} className="p-1 text-center"><button onClick={()=>{setSelected({v,f});setEditLevel(s?.supportLevel??0);setEditComments(s?.comments??"");}} className={`text-base hover:scale-110 transition-transform ${lcolor(s?.supportLevel??0)}`} title={s?.comments}>{HARVEY[s?.supportLevel??0]?.split(" ")[0]??"✕"}</button></td>
              );})}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Click any Harvey Ball to edit the support level and commentary.</p>
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

// ── Previous jobs ─────────────────────────────────────────────────────────

function PreviousJobs({ jobs, onResume, onDelete }: {
  jobs: MarketBuilderJob[];
  onResume: (j: MarketBuilderJob) => void;
  onDelete: (id: string) => void;
}) {
  if (jobs.length === 0) return null;
  const badge = (s: string) => ({ completed:"text-green-700 border-green-300 bg-green-50", published:"text-blue-700 border-blue-300 bg-blue-50", running:"text-amber-700 border-amber-300 bg-amber-50", failed:"text-red-700 border-red-300 bg-red-50" }[s] ?? "text-gray-600 border-gray-300");
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Previous Jobs</p>
      {jobs.map(j => (
        <div key={j.id} className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{j.inputName}</span>
              <Badge variant="outline" className={`text-xs py-0 ${badge(j.status)}`}>{j.status}</Badge>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{new Date(j.createdAt).toLocaleDateString()} · {j.llmProvider}/{j.llmModel}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {j.status === "published" && j.marketId && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => window.open(`/markets/${j.marketId}`, "_blank")}><ExternalLink className="h-3.5 w-3.5" /></Button>
            )}
            {j.status !== "published" && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-600" onClick={() => onResume(j)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />Resume
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onDelete(j.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Publish panel ─────────────────────────────────────────────────────────

function PublishPanel({ job, stageResults, onPublished }: {
  job: MarketBuilderJob;
  stageResults: Record<number, any>;
  onPublished: (marketId: string, isVisible: boolean) => void;
}) {
  const { toast } = useToast();
  const [isVisible, setIsVisible] = useState(false);
  const s1 = stageResults[1]; const s2 = stageResults[2]; const s3 = stageResults[3]; const s4 = stageResults[4]; const s5 = stageResults[5];
  const fc = s3?.categories?.reduce((n: number, c: any) => n + c.features.length, 0) ?? 0;

  const publish = useMutation({
    mutationFn: () => apiRequest(`/api/admin/market-builder/jobs/${job.id}/publish`, "POST", { isVisible }).then(r => r.json()),
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
        {[{l:"Vendors",v:s1?.vendors?.length??0},{l:"Criteria",v:s2?.criteria?.length??0},{l:"Features",v:fc},{l:"Scores",v:s4?.scores?.length??0}].map(({l,v})=>(
          <div key={l} className="rounded-lg bg-white border border-green-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-800">{v}</p>
            <p className="text-xs text-green-600">{l}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-white border border-green-200 p-4">
        <Switch checked={isVisible} onCheckedChange={setIsVisible} />
        <div>
          <p className="text-sm font-medium text-gray-800">Make market visible immediately</p>
          <p className="text-xs text-gray-500">If off, the market is created but hidden — enable it later from the Markets admin tab.</p>
        </div>
      </div>
      <Button className="w-full gap-2 bg-green-700 hover:bg-green-800 h-10" onClick={() => publish.mutate()} disabled={publish.isPending}>
        {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Publish Market
      </Button>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────

type WizardView = "setup" | "stages" | "published";

export function MarketBuilderWizard() {
  const { toast } = useToast();

  // Setup form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4.1-mini");

  // Wizard
  const [view, setView] = useState<WizardView>("setup");
  const [activeJob, setActiveJob] = useState<MarketBuilderJob | null>(null);
  const [activeStage, setActiveStage] = useState(1);   // 1–5 = stages, 6 = publish panel

  // Per-stage state
  const [stagePhases, setStagePhases] = useState<Record<number, StagePhase>>({});
  const [stageResults, setStageResults] = useState<Record<number, any>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState("");

  // Post-publish
  const [publishedMarketId, setPublishedMarketId] = useState<string | null>(null);
  const [publishedVisible, setPublishedVisible] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  const { data: jobs = [], refetch: refetchJobs } = useQuery<MarketBuilderJob[]>({
    queryKey: ["/api/admin/market-builder/jobs"],
  });

  // ── Run a single stage via SSE ────────────────────────────────────────

  const runStage = (jobId: string, stageNum: number) => {
    esRef.current?.close();
    setStreamError(null);
    setProgressMsg("");
    setStagePhases(prev => ({ ...prev, [stageNum]: "running" }));

    const es = new EventSource(`/api/admin/market-builder/jobs/${jobId}/stream?stage=${stageNum}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "stage_complete") {
          setStageResults(prev => ({ ...prev, [stageNum]: event.result }));
          setStagePhases(prev => ({ ...prev, [stageNum]: "done" }));
          es.close();
        } else if (event.type === "stage_error") {
          setStagePhases(prev => ({ ...prev, [stageNum]: "failed" }));
          setStreamError(event.error ?? "Stage failed");
          es.close();
        } else if (event.type === "stage_progress") {
          setProgressMsg(event.message ?? "");
        }
      } catch (_) {}
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStagePhases(prev => ({ ...prev, [stageNum]: "failed" }));
      setStreamError("Connection lost — try running this stage again.");
      es.close();
    };
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  // ── Mutations ─────────────────────────────────────────────────────────

  const createJob = useMutation({
    mutationFn: (data: any) => apiRequest("/api/admin/market-builder/jobs", "POST", data).then(r => r.json()),
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
    mutationFn: (id: string) => apiRequest(`/api/admin/market-builder/jobs/${id}/complete`, "POST").then(r => r.json()),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveEdits = useMutation({
    mutationFn: ({ stageNum, result }: { stageNum: number; result: any }) =>
      apiRequest(`/api/admin/market-builder/jobs/${activeJob!.id}/stages/${stageNum}/result`, "PATCH", result).then(r => r.json()),
    onSuccess: () => toast({ title: "Edits saved" }),
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteJob = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/market-builder/jobs/${id}`, "DELETE"),
    onSuccess: () => refetchJobs(),
  });

  const updateVisibility = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      apiRequest(`/api/admin/market-builder/jobs/${id}/visibility`, "PATCH", { isVisible }).then(r => r.json()),
    onSuccess: (_, { isVisible }) => { setPublishedVisible(isVisible); toast({ title: isVisible ? "Market now visible" : "Market now hidden" }); },
  });

  // ── Approve stage and advance ─────────────────────────────────────────

  const approveStage = async (stageNum: number) => {
    if (stageNum === 5) {
      // All stages done — mark job completed then show publish panel
      await completeJob.mutateAsync(activeJob!.id);
      setActiveStage(6);
    } else {
      setActiveStage(stageNum + 1);
      setStagePhases(prev => ({ ...prev, [stageNum + 1]: "ready" }));
    }
    refetchJobs();
  };

  // ── Resume an existing job ────────────────────────────────────────────

  const handleResume = (job: MarketBuilderJob) => {
    setActiveJob(job);
    setView("stages");
    setStreamError(null);
    setProgressMsg("");

    const phases: Record<number, StagePhase> = {};
    const results: Record<number, any> = {};
    let highestDone = 0;

    (job.stages ?? []).forEach(s => {
      if (s.status === "completed" && s.result) {
        phases[s.stage] = "done";
        results[s.stage] = s.result;
        highestDone = Math.max(highestDone, s.stage);
      } else if (s.status === "failed") {
        phases[s.stage] = "failed";
      }
    });

    setStageResults(results);

    const nextStage = Math.min(highestDone + 1, 5);
    if (job.status === "completed" || job.status === "published") {
      setActiveStage(6);
    } else {
      setActiveStage(nextStage);
      if (!phases[nextStage]) phases[nextStage] = "ready";
    }
    setStagePhases(phases);
  };

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

  const prevJobs = jobs.filter(j => j.id !== activeJob?.id);
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
            <Button className="flex-1 text-sm gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => {
              setView("setup"); setActiveJob(null);
              setName(""); setDescription(""); setCategory(""); setContext("");
              setPublishedMarketId(null); setStageResults({}); setStagePhases({});
            }}><Wand2 className="h-4 w-4"/>Build Another</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup view ────────────────────────────────────────────────────────

  if (view === "setup") {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-blue-600" />AI Market Builder
              <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Beta</Badge>
            </h1>
            <p className="text-sm text-gray-500 mt-1">Describe a technology market. AI generates vendors, criteria, features, scores, and support data — one stage at a time, with your approval between each.</p>
          </div>
          <LLMSelector provider={provider} model={model} onProviderChange={setProvider} onModelChange={setModel} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4 rounded-xl border bg-white p-6">
            <h2 className="font-semibold text-gray-800">Market Details</h2>
            <div className="space-y-1.5">
              <Label className="text-xs">Market Name *</Label>
              <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Enterprise Object Storage" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description *</Label>
              <Textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What technology? Who buys it? What problem does it solve?" rows={4} className="resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Extra context <span className="text-gray-400">(optional)</span></Label>
              <Textarea value={context} onChange={e=>setContext(e.target.value)} placeholder="Specific vendors to include, regional focus, buyer segment…" rows={2} className="resize-none" />
            </div>
            <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700 h-10" onClick={handleSubmit} disabled={createJob.isPending}>
              {createJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Start Building
            </Button>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <p className="font-semibold text-blue-900 mb-3">Step-by-step approval flow</p>
              <ol className="space-y-2">
                {STAGE_META.map(s => (
                  <li key={s.num} className="flex items-start gap-2 text-sm text-blue-800">
                    <span className="font-bold shrink-0">{s.num}.</span>
                    <div><span className="font-medium">{s.label}</span> — <span className="text-blue-600">{s.desc}</span></div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-blue-600 mt-3 pt-3 border-t border-blue-200">Each stage stops for your review. You can add research sources, edit the output, or re-run before approving and moving on.</p>
            </div>
            <PreviousJobs jobs={prevJobs} onResume={handleResume} onDelete={id=>deleteJob.mutate(id)} />
          </div>
        </div>
      </div>
    );
  }

  // ── Stages view ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{activeJob?.inputName}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{activeJob?.llmProvider} / {activeJob?.llmModel}</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { esRef.current?.close(); setView("setup"); }}>
          <ChevronLeft className="h-4 w-4" />Back
        </Button>
      </div>

      {/* Step tracker */}
      <div className="rounded-xl border bg-white p-3">
        <StepTracker
          activeStage={activeStage}
          stagePhases={stagePhases}
          onStepClick={n => { if (stagePhases[n] === "done") setActiveStage(n); }}
        />
      </div>

      {/* Publish panel (stage 6) */}
      {activeStage === 6 && (
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

      {/* Active stage panel (stages 1-5) */}
      {activeStage <= 5 && currentMeta && (
        <div className="rounded-xl border bg-white">
          {/* Stage header */}
          <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Stage {activeStage} of 5</span>
                {currentPhase === "running" && <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 gap-1 text-xs py-0"><Loader2 className="h-3 w-3 animate-spin"/>Running</Badge>}
                {currentPhase === "done" && <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs py-0">Complete</Badge>}
                {currentPhase === "failed" && <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 text-xs py-0">Failed</Badge>}
              </div>
              <h2 className="text-lg font-bold text-gray-900">{currentMeta.label}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{currentMeta.desc}</p>
            </div>
            {/* Re-run button (only when done) */}
            {currentPhase === "done" && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={() => runStage(activeJob!.id, activeStage)}>
                <RefreshCw className="h-3.5 w-3.5" />Re-run Stage
              </Button>
            )}
          </div>

          <div className="p-6 space-y-5">
            {/* READY state — show sources + run button */}
            {(currentPhase === "ready" || !currentPhase) && (
              <>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-1">
                  <p className="text-sm font-semibold text-gray-700">What this stage will generate</p>
                  <p className="text-sm text-gray-500">{currentMeta.what}</p>
                </div>
                <SourcesOnlyNotice />
                <SourcesPanel jobId={activeJob!.id} currentStage={activeStage} />
                <div className="flex items-center justify-between pt-2">
                  {activeStage > 1 ? (
                    <Button variant="outline" className="gap-2" onClick={() => setActiveStage(s => s - 1)}>
                      <ChevronLeft className="h-4 w-4" />Stage {activeStage - 1}
                    </Button>
                  ) : <div />}
                  <Button className="gap-2 bg-blue-600 hover:bg-blue-700 px-6" onClick={() => runStage(activeJob!.id, activeStage)}>
                    <PlayCircle className="h-4 w-4" />Run Stage {activeStage}
                  </Button>
                </div>
              </>
            )}

            {/* RUNNING state */}
            {currentPhase === "running" && (
              <div className="py-12 flex flex-col items-center gap-4 text-center">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">AI is working on Stage {activeStage}: {currentMeta.label}</p>
                  {progressMsg && <p className="text-xs text-gray-500 mt-1">{progressMsg}</p>}
                </div>
                <p className="text-xs text-gray-400 max-w-sm">This may take 30–90 seconds. The page will update automatically when complete.</p>
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
                <SourcesPanel jobId={activeJob!.id} currentStage={activeStage} />
                <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => runStage(activeJob!.id, activeStage)}>
                  <RefreshCw className="h-4 w-4" />Try Again
                </Button>
              </>
            )}

            {/* DONE state — sources + editable results */}
            {currentPhase === "done" && currentResult && (
              <>
                {/* Inline dirty-save wrapper */}
                <DoneStageView
                  stageNum={activeStage}
                  result={currentResult}
                  jobId={activeJob!.id}
                  onSave={r => {
                    setStageResults(prev => ({ ...prev, [activeStage]: r }));
                    saveEdits.mutate({ stageNum: activeStage, result: r });
                  }}
                />
              </>
            )}
          </div>

          {/* Bottom nav — only when done */}
          {currentPhase === "done" && (
            <div className="border-t px-6 py-4 flex items-center justify-between">
              {activeStage > 1 ? (
                <Button variant="outline" className="gap-2" onClick={() => setActiveStage(s => s - 1)}>
                  <ChevronLeft className="h-4 w-4" />Stage {activeStage - 1}
                </Button>
              ) : <div />}
              <Button
                className="gap-2 bg-green-600 hover:bg-green-700 px-6"
                onClick={() => approveStage(activeStage)}
                disabled={completeJob.isPending}
              >
                {completeJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {activeStage < 5 ? `Approve & Continue to Stage ${activeStage + 1}` : "Approve & Go to Publish"}
              </Button>
            </div>
          )}
        </div>
      )}

      <PreviousJobs jobs={prevJobs} onResume={handleResume} onDelete={id=>deleteJob.mutate(id)} />
    </div>
  );
}

// ── Done stage view (sources + editable results with save) ────────────────

function DoneStageView({ stageNum, result, jobId, onSave }: {
  stageNum: number; result: any; jobId: string;
  onSave: (r: any) => void;
}) {
  const [localResult, setLocalResult] = useState(result);
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => { setLocalResult(result); setIsDirty(false); }, [result]);
  const handleChange = (r: any) => { setLocalResult(r); setIsDirty(true); };

  return (
    <div className="space-y-5">
      <SourcesPanel jobId={jobId} currentStage={stageNum} />

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
        {stageNum === 2 && <Stage2Editor result={localResult} onChange={handleChange} />}
        {stageNum === 3 && <Stage3Editor result={localResult} onChange={handleChange} />}
        {stageNum === 4 && <Stage4Editor result={localResult} onChange={handleChange} />}
        {stageNum === 5 && <Stage5Editor result={localResult} onChange={handleChange} />}
      </div>
    </div>
  );
}
