import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import {
  Swords, Loader2, ArrowLeft, Download, FileText,
  ChevronDown, ChevronUp, Sparkles, Trophy, CheckCircle2,
  RefreshCw, Shield, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────

interface VendorSupport {
  supportLevel: number;
  comments: string | null;
}

interface Feature {
  id: string;
  name: string;
  description: string | null;
  vendorSupport: Record<string, VendorSupport>;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  features: Feature[];
}

interface CriteriaRow {
  criteriaId: string;
  criteriaName: string;
  criteriaCategory: string | null;
  criteriaDescription: string | null;
  weight: number;
  vendorScores: Record<string, { score: string; notes: string | null }>;
}

interface Vendor {
  id: string;
  name: string;
  description: string | null;
}

interface BattleCardData {
  market: { id: string; name: string; description: string | null };
  vendors: Vendor[];
  productCategories: Category[];
  ecosystemCategories: Category[];
  criteriaRows: CriteriaRow[];
}

interface AiSummary {
  topBullets: string[];
  categoryInsights: Record<string, string>;
  criteriaInsights: Record<string, string>;
  focalVendorName?: string;
}

type WizardStep = 2 | 3 | 4 | "result";

// ── Harvey Ball ────────────────────────────────────────────────────────────

function HarveyBall({ level, isFocal }: { level: number; isFocal?: boolean }) {
  const cx = 10, cy = 10, r = 8;
  const stroke = isFocal ? "#10b981" : "#475569";
  const fill = isFocal ? "#10b981" : "#22d3ee";
  const lv = Math.min(4, Math.max(0, level));
  if (lv <= 0) return (
    <svg width="22" height="22" viewBox="0 0 20 20" className="inline-block">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
  if (lv >= 4) return (
    <svg width="22" height="22" viewBox="0 0 20 20" className="inline-block">
      <circle cx={cx} cy={cy} r={r} fill={fill} />
    </svg>
  );
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (lv / 4) * 2 * Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = lv > 2 ? 1 : 0;
  const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" className="inline-block">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth="1.5" />
      <path d={path} fill={fill} />
    </svg>
  );
}

const HARVEY_LABELS = ["None", "Limited", "Partial", "Good", "Full"];
const HARVEY_COLORS = ["text-slate-600", "text-amber-500", "text-amber-400", "text-cyan-400", "text-cyan-300"];

function cleanName(n: string) {
  return n.replace(/^ITMAP for /i, "").replace(/^Spectio for /i, "");
}

// ── Wizard Steps ───────────────────────────────────────────────────────────

function WizardProgress({ step }: { step: WizardStep }) {
  const steps = [
    { n: 1, label: "Market" },
    { n: 2, label: "Your Vendor" },
    { n: 3, label: "Competitors" },
    { n: 4, label: "Categories" },
  ];
  const current = step === "result" ? 5 : step;
  return (
    <div className="flex items-center justify-center gap-2 mb-10 flex-wrap">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              done ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : active ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
              : "bg-slate-800 text-slate-500 border border-slate-700"
            }`}>
              <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                done ? "bg-emerald-500 text-white"
                : active ? "bg-cyan-500 text-white"
                : "bg-slate-700 text-slate-400"
              }`}>
                {done ? "✓" : s.n}
              </span>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-5 ${done ? "bg-emerald-500/40" : "bg-slate-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Feature Row with expandable commentary ─────────────────────────────────

function FeatureRow({
  feature,
  vendorIds,
  focalVendorId,
  vendors,
}: {
  feature: Feature;
  vendorIds: string[];
  focalVendorId: string;
  vendors: Vendor[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAnyCommentary = vendorIds.some(vid => feature.vendorSupport[vid]?.comments);

  return (
    <div className="border-b border-white/5 last:border-0">
      <div
        className={`grid gap-2 py-2.5 px-3 hover:bg-white/[0.02] transition-colors ${hasAnyCommentary ? "cursor-pointer" : ""}`}
        style={{ gridTemplateColumns: `1fr repeat(${vendorIds.length}, minmax(80px,1fr)) auto` }}
        onClick={() => hasAnyCommentary && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-200">{feature.name}</span>
          {feature.description && (
            <span className="text-[11px] text-slate-500 hidden lg:inline truncate max-w-[180px]">{feature.description}</span>
          )}
        </div>
        {vendorIds.map(vid => {
          const support = feature.vendorSupport[vid];
          const level = support?.supportLevel ?? 0;
          const isFocal = vid === focalVendorId;
          return (
            <div key={vid} className={`flex flex-col items-center gap-0.5 ${isFocal ? "bg-emerald-950/30 rounded-lg py-1" : ""}`}>
              <HarveyBall level={level} isFocal={isFocal} />
              <span className={`text-[10px] font-medium ${isFocal ? "text-emerald-400" : HARVEY_COLORS[level]}`}>
                {HARVEY_LABELS[level]}
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-end">
          {hasAnyCommentary ? (
            expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          ) : <span className="w-3.5" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-white/5">
          <div className={`grid gap-3 ${vendorIds.length <= 3 ? "grid-cols-1 sm:grid-cols-" + vendorIds.length : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}
            style={{ gridTemplateColumns: `repeat(${Math.min(vendorIds.length, 3)}, 1fr)` }}>
            {vendorIds.map(vid => {
              const vendor = vendors.find(v => v.id === vid);
              const support = feature.vendorSupport[vid];
              const isFocal = vid === focalVendorId;
              if (!support?.comments) return null;
              return (
                <div key={vid} className={`rounded-lg p-3 ${isFocal ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900 border border-white/5"}`}>
                  <p className={`text-xs font-semibold mb-1.5 ${isFocal ? "text-emerald-400" : "text-cyan-400"}`}>
                    {vendor?.name ?? vid}
                    {isFocal && <span className="ml-1.5 text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full">Your vendor</span>}
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">{support.comments}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Criteria Row with expandable notes ─────────────────────────────────────

function CriteriaRowComponent({
  row,
  vendorIds,
  focalVendorId,
  vendors,
  criteriaInsight,
}: {
  row: CriteriaRow;
  vendorIds: string[];
  focalVendorId: string;
  vendors: Vendor[];
  criteriaInsight?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasNotes = vendorIds.some(vid => row.vendorScores[vid]?.notes);
  const focalScore = parseFloat(row.vendorScores[focalVendorId]?.score ?? "0") || 0;
  const focalLeads = vendorIds.every(vid => {
    if (vid === focalVendorId) return true;
    return focalScore >= (parseFloat(row.vendorScores[vid]?.score ?? "0") || 0);
  });

  return (
    <div className="border-b border-white/5 last:border-0">
      <div
        className={`grid gap-2 py-2.5 px-3 hover:bg-white/[0.02] transition-colors ${hasNotes ? "cursor-pointer" : ""}`}
        style={{ gridTemplateColumns: `1fr auto repeat(${vendorIds.length}, minmax(90px,1fr)) auto` }}
        onClick={() => hasNotes && setExpanded(e => !e)}
      >
        <div className="flex flex-col justify-center">
          <span className="text-sm text-slate-200 flex items-center gap-1.5">
            {row.criteriaName}
            {focalLeads && criteriaInsight && (
              <Trophy className="h-3 w-3 text-amber-400" />
            )}
          </span>
          {row.criteriaCategory && (
            <span className="text-[10px] text-slate-500 mt-0.5">{row.criteriaCategory}</span>
          )}
        </div>
        <div className="flex items-center">
          <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded font-mono">{row.weight}%</span>
        </div>
        {vendorIds.map(vid => {
          const scoreData = row.vendorScores[vid];
          const score = parseFloat(scoreData?.score ?? "0") || 0;
          const pct = Math.round((score / 10) * 100);
          const isFocal = vid === focalVendorId;
          return (
            <div key={vid} className={`flex flex-col gap-1 px-1 ${isFocal ? "bg-emerald-950/30 rounded-lg py-1.5" : ""}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${isFocal ? "text-emerald-400" : "text-cyan-300"}`}>
                  {score.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-500">/10</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${isFocal ? "bg-emerald-500" : "bg-cyan-500/70"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="flex items-center">
          {hasNotes ? (
            expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          ) : <span className="w-3.5" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-white/5">
          {criteriaInsight && (
            <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-300/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
              <Trophy className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
              <span>{criteriaInsight}</span>
            </div>
          )}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(vendorIds.length, 3)}, 1fr)` }}>
            {vendorIds.map(vid => {
              const vendor = vendors.find(v => v.id === vid);
              const scoreData = row.vendorScores[vid];
              const isFocal = vid === focalVendorId;
              if (!scoreData?.notes) return null;
              return (
                <div key={vid} className={`rounded-lg p-3 ${isFocal ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900 border border-white/5"}`}>
                  <p className={`text-xs font-semibold mb-1.5 ${isFocal ? "text-emerald-400" : "text-cyan-400"}`}>
                    {vendor?.name ?? vid}
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">{scoreData.notes}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category section ───────────────────────────────────────────────────────

function CategorySection({
  category,
  vendorIds,
  focalVendorId,
  vendors,
  insight,
}: {
  category: Category;
  vendorIds: string[];
  focalVendorId: string;
  vendors: Vendor[];
  insight?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-900/60 border border-white/5 rounded-t-xl hover:bg-slate-900/80 transition-colors text-left"
      >
        <div className="flex-1">
          <span className="text-sm font-semibold text-white">{category.name}</span>
          <span className="ml-2 text-[11px] text-slate-500">{category.features.length} features</span>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
      </button>

      {!collapsed && (
        <div className="border border-t-0 border-white/5 rounded-b-xl overflow-hidden">
          {insight && (
            <div className="flex items-start gap-2 px-3 py-2 bg-cyan-950/20 border-b border-white/5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-cyan-200/80 leading-relaxed">{insight}</p>
            </div>
          )}

          {/* Column headers */}
          <div
            className="grid gap-2 px-3 py-2 bg-slate-900/40 border-b border-white/5 text-[11px] font-medium text-slate-500"
            style={{ gridTemplateColumns: `1fr repeat(${vendorIds.length}, minmax(80px,1fr)) auto` }}
          >
            <span>Feature</span>
            {vendorIds.map(vid => {
              const vendor = vendors.find(v => v.id === vid);
              const isFocal = vid === focalVendorId;
              return (
                <span key={vid} className={`text-center truncate ${isFocal ? "text-emerald-400 font-semibold" : "text-slate-400"}`}>
                  {vendor?.name ?? vid}
                  {isFocal && " ★"}
                </span>
              );
            })}
            <span className="w-4" />
          </div>

          {category.features.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-slate-500">No features in this category</div>
          ) : (
            category.features.map(feature => (
              <FeatureRow
                key={feature.id}
                feature={feature}
                vendorIds={vendorIds}
                focalVendorId={focalVendorId}
                vendors={vendors}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BattleCardDetailPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const [, navigate] = useLocation();
  const { hasFeature, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>(2);
  const [focalVendorId, setFocalVendorId] = useState<string | null>(null);
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [selectedProductCatIds, setSelectedProductCatIds] = useState<string[] | "all">("all");
  const [selectedEcoCatIds, setSelectedEcoCatIds] = useState<string[] | "all">("all");

  // Result state
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const { data, isLoading, error } = useQuery<BattleCardData>({
    queryKey: ["/api/battle-cards", marketId],
    queryFn: async () => {
      const r = await fetch(`/api/battle-cards/${marketId}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!marketId,
  });

  // ── Computed selections ──────────────────────────────────────────────────

  const allVendorIds = useMemo(() => {
    if (!focalVendorId) return competitorIds;
    return [focalVendorId, ...competitorIds];
  }, [focalVendorId, competitorIds]);

  const visibleProductCats = useMemo(() => {
    if (!data) return [];
    if (selectedProductCatIds === "all") return data.productCategories;
    return data.productCategories.filter(c => selectedProductCatIds.includes(c.id));
  }, [data, selectedProductCatIds]);

  const visibleEcoCats = useMemo(() => {
    if (!data) return [];
    if (selectedEcoCatIds === "all") return data.ecosystemCategories;
    return data.ecosystemCategories.filter(c => selectedEcoCatIds.includes(c.id));
  }, [data, selectedEcoCatIds]);

  const focalVendor = useMemo(() => data?.vendors.find(v => v.id === focalVendorId) ?? null, [data, focalVendorId]);
  const selectedVendors = useMemo(() => data?.vendors.filter(v => allVendorIds.includes(v.id)) ?? [], [data, allVendorIds]);

  const weightedTotal = useMemo(() => {
    if (!data) return {};
    const totals: Record<string, number> = {};
    for (const row of data.criteriaRows) {
      for (const [vid, s] of Object.entries(row.vendorScores)) {
        if (!allVendorIds.includes(vid)) continue;
        const score = parseFloat(s.score) || 0;
        totals[vid] = (totals[vid] ?? 0) + (score * (row.weight / 100));
      }
    }
    return totals;
  }, [data, allVendorIds]);

  // ── Export mutation ──────────────────────────────────────────────────────

  const exportMutation = useMutation({
    mutationFn: async ({ format }: { format: "pdf" | "pptx" }) => {
      if (!data || !focalVendorId) return;

      const sections: any[] = [];

      for (const cat of visibleProductCats) {
        sections.push({
          type: "product",
          title: cat.name,
          categoryName: cat.name,
          rows: cat.features.map(f => ({
            name: f.name,
            cells: allVendorIds.map(vid => ({
              vendorId: vid,
              value: f.vendorSupport[vid]?.supportLevel ?? 0,
              notes: f.vendorSupport[vid]?.comments ?? null,
            })),
          })),
        });
      }

      for (const cat of visibleEcoCats) {
        sections.push({
          type: "ecosystem",
          title: cat.name,
          categoryName: cat.name,
          rows: cat.features.map(f => ({
            name: f.name,
            cells: allVendorIds.map(vid => ({
              vendorId: vid,
              value: f.vendorSupport[vid]?.supportLevel ?? 0,
              notes: f.vendorSupport[vid]?.comments ?? null,
            })),
          })),
        });
      }

      if (data.criteriaRows.length > 0) {
        sections.push({
          type: "criteria",
          title: "Criteria Scores",
          categoryName: "Criteria Scores",
          rows: data.criteriaRows.map(r => ({
            name: `${r.criteriaName} (${r.weight}%)`,
            cells: allVendorIds.map(vid => ({
              vendorId: vid,
              value: parseFloat(r.vendorScores[vid]?.score ?? "0") || 0,
              notes: r.vendorScores[vid]?.notes ?? null,
            })),
          })),
        });
      }

      const payload = {
        marketName: cleanName(data.market.name),
        vendorNames: allVendorIds.map(vid => selectedVendors.find(v => v.id === vid)?.name ?? vid),
        vendorIds: allVendorIds,
        focalVendorName: focalVendor?.name,
        aiSummary: aiSummary ?? undefined,
        sections,
      };

      const r = await fetch(`/api/battle-cards/${marketId}/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `battle-card-${(focalVendor?.name ?? "card").replace(/\s+/g, "-").toLowerCase()}-vs-competition.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err: any) => toast({ title: "Export failed", description: err.message, variant: "destructive" }),
  });

  // ── Generate handler ─────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!focalVendorId || competitorIds.length === 0 || !data) return;
    setWizardStep("result");
    setAiSummaryLoading(true);
    setAiSummary(null);
    try {
      const selectedProductNames = selectedProductCatIds === "all"
        ? data.productCategories.map(c => c.name)
        : data.productCategories.filter(c => selectedProductCatIds.includes(c.id)).map(c => c.name);
      const selectedEcoNames = selectedEcoCatIds === "all"
        ? data.ecosystemCategories.map(c => c.name)
        : data.ecosystemCategories.filter(c => selectedEcoCatIds.includes(c.id)).map(c => c.name);

      const r = await fetch(`/api/battle-cards/${marketId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          focalVendorId,
          competitorIds,
          productCategoryNames: selectedProductNames,
          ecosystemCategoryNames: selectedEcoNames,
        }),
      });
      if (r.ok) {
        const summary = await r.json();
        setAiSummary(summary);
      }
    } catch {
      // summary unavailable — card still shows
    } finally {
      setAiSummaryLoading(false);
    }
  };

  // ── Auth gate ────────────────────────────────────────────────────────────

  if (!authLoading && !hasFeature("battle_cards")) {
    return <LockedFeaturePanel featureKey="battle_cards" variant="dark" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="text-center">
          <p className="mb-4">Failed to load market data</p>
          <Button variant="outline" onClick={() => navigate("/battle-cards")}>Back to markets</Button>
        </div>
      </div>
    );
  }

  const marketDisplayName = cleanName(data.market.name);

  // ── WIZARD ───────────────────────────────────────────────────────────────

  if (wizardStep !== "result") {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-3xl mx-auto px-4 py-12">

          {/* Back */}
          <button
            onClick={() => wizardStep === 2 ? navigate("/battle-cards") : setWizardStep(s => (s as number) - 1 as WizardStep)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-8 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {wizardStep === 2 ? "All markets" : "Back"}
          </button>

          {/* Market label */}
          <div className="flex items-center gap-2 mb-6">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-600/20 flex items-center justify-center">
              <Swords className="h-4 w-4 text-cyan-400" />
            </div>
            <span className="text-slate-400 text-sm">{marketDisplayName}</span>
          </div>

          <WizardProgress step={wizardStep} />

          {/* ── Step 2: Your Vendor ── */}
          {wizardStep === 2 && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Who do you represent?</h2>
              <p className="text-slate-400 text-sm mb-8">
                Select the vendor whose strengths you want to highlight in this battle card.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.vendors.map(vendor => (
                  <button
                    key={vendor.id}
                    onClick={() => {
                      setFocalVendorId(vendor.id);
                      setCompetitorIds(prev => prev.filter(id => id !== vendor.id));
                      setWizardStep(3);
                    }}
                    className="group text-left bg-slate-900 border border-white/5 rounded-xl p-4 hover:border-cyan-500/40 hover:bg-slate-800/80 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500/15 to-violet-600/15 flex items-center justify-center text-sm font-bold text-cyan-400">
                        {vendor.name.charAt(0).toUpperCase()}
                      </div>
                      <ChevronDown className="h-4 w-4 text-slate-600 group-hover:text-cyan-400 -rotate-90 transition-colors" />
                    </div>
                    <p className="font-semibold text-white text-sm mb-1">{vendor.name}</p>
                    {vendor.description && (
                      <p className="text-slate-500 text-xs line-clamp-2">{vendor.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 3: Competitors ── */}
          {wizardStep === 3 && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Who are they competing against?</h2>
              <p className="text-slate-400 text-sm mb-2">
                Select up to 5 competitors to include in the comparison.
              </p>
              {focalVendor && (
                <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 text-xs text-emerald-300 mb-6">
                  <CheckCircle2 className="h-3 w-3" />
                  Your vendor: <strong>{focalVendor.name}</strong>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {data.vendors
                  .filter(v => v.id !== focalVendorId)
                  .map(vendor => {
                    const selected = competitorIds.includes(vendor.id);
                    const maxed = !selected && competitorIds.length >= 5;
                    return (
                      <button
                        key={vendor.id}
                        disabled={maxed}
                        onClick={() => setCompetitorIds(prev =>
                          selected ? prev.filter(id => id !== vendor.id) : [...prev, vendor.id]
                        )}
                        className={`text-left rounded-xl p-4 border transition-all ${
                          selected
                            ? "bg-cyan-950/40 border-cyan-500/40"
                            : maxed
                            ? "bg-slate-900/40 border-white/3 opacity-40 cursor-not-allowed"
                            : "bg-slate-900 border-white/5 hover:border-white/15"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                            selected ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-800 text-slate-400"
                          }`}>
                            {selected ? "✓" : vendor.name.charAt(0).toUpperCase()}
                          </div>
                          {selected && <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[10px]">Selected</Badge>}
                        </div>
                        <p className={`font-semibold text-sm mb-1 ${selected ? "text-white" : "text-slate-300"}`}>{vendor.name}</p>
                        {vendor.description && (
                          <p className="text-slate-500 text-xs line-clamp-2">{vendor.description}</p>
                        )}
                      </button>
                    );
                  })}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">{competitorIds.length} competitor{competitorIds.length !== 1 ? "s" : ""} selected</p>
                <Button
                  disabled={competitorIds.length === 0}
                  onClick={() => setWizardStep(4)}
                  className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0"
                >
                  Continue <ChevronDown className="ml-1 h-4 w-4 -rotate-90" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Categories ── */}
          {wizardStep === 4 && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Which categories matter?</h2>
              <p className="text-slate-400 text-sm mb-6">
                Narrow the comparison to specific areas, or include everything.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Product categories */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-300">Product Features</h3>
                    <button
                      onClick={() => setSelectedProductCatIds(selectedProductCatIds === "all" ? [] : "all")}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selectedProductCatIds === "all"
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500"
                      }`}
                    >
                      {selectedProductCatIds === "all" ? "All selected" : "Select all"}
                    </button>
                  </div>
                  {data.productCategories.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No product categories</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.productCategories.map(cat => {
                        const active = selectedProductCatIds === "all" || (selectedProductCatIds as string[]).includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => {
                              if (selectedProductCatIds === "all") {
                                setSelectedProductCatIds(data.productCategories.filter(c => c.id !== cat.id).map(c => c.id));
                              } else {
                                const arr = selectedProductCatIds as string[];
                                setSelectedProductCatIds(
                                  arr.includes(cat.id) ? arr.filter(id => id !== cat.id) : [...arr, cat.id]
                                );
                              }
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              active
                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                                : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {cat.name}
                            <span className="ml-1.5 opacity-60">{cat.features.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Ecosystem categories */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-300">Ecosystem</h3>
                    <button
                      onClick={() => setSelectedEcoCatIds(selectedEcoCatIds === "all" ? [] : "all")}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selectedEcoCatIds === "all"
                          ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500"
                      }`}
                    >
                      {selectedEcoCatIds === "all" ? "All selected" : "Select all"}
                    </button>
                  </div>
                  {data.ecosystemCategories.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No ecosystem categories</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.ecosystemCategories.map(cat => {
                        const active = selectedEcoCatIds === "all" || (selectedEcoCatIds as string[]).includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => {
                              if (selectedEcoCatIds === "all") {
                                setSelectedEcoCatIds(data.ecosystemCategories.filter(c => c.id !== cat.id).map(c => c.id));
                              } else {
                                const arr = selectedEcoCatIds as string[];
                                setSelectedEcoCatIds(
                                  arr.includes(cat.id) ? arr.filter(id => id !== cat.id) : [...arr, cat.id]
                                );
                              }
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              active
                                ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                                : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {cat.name}
                            <span className="ml-1.5 opacity-60">{cat.features.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 mb-6 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white font-medium">Ready to generate</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <strong className="text-emerald-300">{focalVendor?.name}</strong> vs {competitorIds.length} competitor{competitorIds.length !== 1 ? "s" : ""} ·{" "}
                    {selectedProductCatIds === "all" ? "All product" : `${(selectedProductCatIds as string[]).length} product`} ·{" "}
                    {selectedEcoCatIds === "all" ? "All ecosystem" : `${(selectedEcoCatIds as string[]).length} ecosystem`} categories
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">AI win summary will be generated automatically</p>
                <Button
                  onClick={handleGenerate}
                  className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-6"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Battle Card
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── RESULT VIEW ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Top bar */}
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setWizardStep(4)}
              className="mt-0.5 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Back to wizard"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <div>
              <p className="text-xs text-slate-500 mb-1">{marketDisplayName}</p>
              <h1 className="text-xl font-bold text-white">
                <span className="text-emerald-400">{focalVendor?.name}</span>
                <span className="text-slate-400 font-normal mx-2">vs</span>
                {data.vendors
                  .filter(v => competitorIds.includes(v.id))
                  .map(v => v.name)
                  .join(" · ")}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5 gap-1.5"
              onClick={() => exportMutation.mutate({ format: "pdf" })}
              disabled={exportMutation.isPending}
            >
              <FileText className="h-4 w-4" />
              Export PDF
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0 gap-1.5"
              onClick={() => exportMutation.mutate({ format: "pptx" })}
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4" />
              Export PPTX
            </Button>
          </div>
        </div>

        {/* AI Win Summary */}
        <div className="mb-6">
          {aiSummaryLoading ? (
            <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse" />
                <span className="text-sm text-slate-400">Analyzing strengths…</span>
              </div>
              <div className="space-y-2">
                {[70, 85, 60, 75].map((w, i) => (
                  <div key={i} className="h-3 bg-slate-800 rounded-full animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          ) : aiSummary && aiSummary.topBullets.length > 0 ? (
            <div className="bg-gradient-to-r from-emerald-950/40 to-cyan-950/30 border border-emerald-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-5 w-5 text-amber-400" />
                <h2 className="font-semibold text-white">Why <span className="text-emerald-400">{focalVendor?.name}</span> Leads</h2>
                <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/25 text-[10px]">AI analysis</Badge>
              </div>
              <ul className="space-y-2">
                {aiSummary.topBullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <Shield className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-slate-200 leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Main content tabs */}
        <Tabs defaultValue="product">
          <TabsList className="bg-slate-900 border border-white/5 mb-4">
            <TabsTrigger value="product" className="data-[state=active]:bg-white/10">
              Product Features
              <span className="ml-1.5 text-[10px] opacity-60">{visibleProductCats.length}</span>
            </TabsTrigger>
            <TabsTrigger value="ecosystem" className="data-[state=active]:bg-white/10">
              Ecosystem
              <span className="ml-1.5 text-[10px] opacity-60">{visibleEcoCats.length}</span>
            </TabsTrigger>
            <TabsTrigger value="criteria" className="data-[state=active]:bg-white/10">
              Criteria Scores
            </TabsTrigger>
          </TabsList>

          {/* Product Features */}
          <TabsContent value="product">
            {visibleProductCats.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No product categories selected</div>
            ) : (
              visibleProductCats.map(cat => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  vendorIds={allVendorIds}
                  focalVendorId={focalVendorId!}
                  vendors={selectedVendors}
                  insight={aiSummary?.categoryInsights?.[cat.name]}
                />
              ))
            )}
          </TabsContent>

          {/* Ecosystem */}
          <TabsContent value="ecosystem">
            {visibleEcoCats.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No ecosystem categories selected</div>
            ) : (
              visibleEcoCats.map(cat => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  vendorIds={allVendorIds}
                  focalVendorId={focalVendorId!}
                  vendors={selectedVendors}
                  insight={aiSummary?.categoryInsights?.[cat.name]}
                />
              ))
            )}
          </TabsContent>

          {/* Criteria Scores */}
          <TabsContent value="criteria">
            <div className="border border-white/5 rounded-xl overflow-hidden">
              {/* Column headers */}
              <div
                className="grid gap-2 px-3 py-3 bg-slate-900/60 border-b border-white/5 text-[11px] font-medium text-slate-500"
                style={{ gridTemplateColumns: `1fr auto repeat(${allVendorIds.length}, minmax(90px,1fr)) auto` }}
              >
                <span>Criterion</span>
                <span className="w-10">Weight</span>
                {allVendorIds.map(vid => {
                  const vendor = selectedVendors.find(v => v.id === vid);
                  const isFocal = vid === focalVendorId;
                  return (
                    <span key={vid} className={`text-center truncate ${isFocal ? "text-emerald-400 font-semibold" : "text-slate-400"}`}>
                      {vendor?.name ?? vid}{isFocal && " ★"}
                    </span>
                  );
                })}
                <span className="w-4" />
              </div>

              {data.criteriaRows.map(row => (
                <CriteriaRowComponent
                  key={row.criteriaId}
                  row={row}
                  vendorIds={allVendorIds}
                  focalVendorId={focalVendorId!}
                  vendors={selectedVendors}
                  criteriaInsight={aiSummary?.criteriaInsights?.[row.criteriaName]}
                />
              ))}

              {/* Weighted Total */}
              <div
                className="grid gap-2 px-3 py-3 bg-slate-900/80 border-t border-white/10 text-sm font-semibold"
                style={{ gridTemplateColumns: `1fr auto repeat(${allVendorIds.length}, minmax(90px,1fr)) auto` }}
              >
                <span className="text-slate-300">Weighted Total</span>
                <span className="w-10" />
                {allVendorIds.map(vid => {
                  const total = weightedTotal[vid] ?? 0;
                  const isFocal = vid === focalVendorId;
                  return (
                    <span key={vid} className={`text-center ${isFocal ? "text-emerald-300" : "text-cyan-300"}`}>
                      {total.toFixed(2)}
                    </span>
                  );
                })}
                <span className="w-4" />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
