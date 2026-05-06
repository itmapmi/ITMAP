import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  XCircle,
  Lightbulb,
  AlertCircle,
  BarChart3,
  Layers,
  Pencil,
  Network,
  Radio,
  ExternalLink,
} from "lucide-react";
import { SignalCard, type SignalData } from "@/components/signal-card";
import type { Vendor, Market } from "@shared/schema";

interface VendorSignalsPage {
  data: SignalData[];
  total: number;
  limit: number;
  offset: number;
}

const SIGNAL_SOURCE_TYPES = [
  { value: "all", label: "All Sources" },
  { value: "hackernews", label: "Hacker News" },
  { value: "reddit", label: "Reddit" },
  { value: "github", label: "GitHub" },
  { value: "layoffs", label: "Layoffs" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────

type EvalType = "vendor_evaluation" | "product_evaluation" | "ecosystem_evaluation";

interface SourceSignal {
  id: string;
  sourceType: string;
  title: string | null;
  content: string | null;
  url: string | null;
  sentiment: string | null;
  impactLabel: string | null;
  collectedAt: string | null;
  fedIntoSuggestion: boolean;
}

interface AiSuggestion {
  id: string;
  vendorId: string;
  marketId: string;
  vendorName: string;
  marketName: string;
  status: string;
  suggestionType: "criterion_score" | "feature_support";
  subjectId: string;
  subjectName: string;
  subjectCategory: string | null;
  currentValue: string | null;
  suggestedValue: string | null;
  currentCommentary: string | null;
  suggestedCommentary: string | null;
  reasoning: string;
  confidence: "HIGH" | "MEDIUM";
  triggeredByArticleIds: string[] | null;
  createdAt: string;
  reviewedAt: string | null;
  sourceSignal?: SourceSignal | null;
}

interface Criteria {
  id: string;
  name: string;
  category: string;
  description?: string | null;
}

interface Feature {
  id: string;
  name: string;
  categoryId: string;
  displayOrder?: number | null;
}

interface FeatureCategoryWithFeatures {
  id: string;
  name: string;
  marketId: string;
  isEcosystem: boolean;
  displayOrder?: number | null;
  features: Feature[];
}

// ─── Harvey Ball labels ───────────────────────────────────────────────────

const HARVEY_OPTIONS = [
  { value: "0", label: "0 — Not Supported" },
  { value: "1", label: "1 — Limited (25%)" },
  { value: "2", label: "2 — Partial (50%)" },
  { value: "3", label: "3 — Good (75%)" },
  { value: "4", label: "4 — Full Support (100%)" },
];

const EVAL_TYPE_OPTIONS: { value: EvalType; label: string; icon: React.ReactNode }[] = [
  { value: "vendor_evaluation", label: "Vendor Evaluation", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { value: "product_evaluation", label: "Product Evaluation", icon: <Layers className="h-3.5 w-3.5" /> },
  { value: "ecosystem_evaluation", label: "Ecosystem Evaluation", icon: <Network className="h-3.5 w-3.5" /> },
];

// ─── Single suggestion card ───────────────────────────────────────────────

function SuggestionCard({
  s,
  onApprove,
  onReject,
  isMutating,
}: {
  s: AiSuggestion;
  onApprove: (id: string, value: number, commentary: string, overrideSubjectId: string, overrideEvalType: EvalType) => void;
  onReject: (id: string) => void;
  isMutating: boolean;
}) {
  const currentVal = s.currentValue != null ? parseFloat(s.currentValue) : null;
  const isPending = s.status === "pending";
  const isScore = s.suggestionType === "criterion_score";

  const [evalType, setEvalType] = useState<EvalType>(
    isScore ? "vendor_evaluation" : "product_evaluation"
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [editedValue, setEditedValue] = useState<string>("");
  const [editedCommentary, setEditedCommentary] = useState<string>(s.suggestedCommentary ?? "");

  // Fetch all criteria (global, not per-market)
  const { data: allCriteria = [] } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
    staleTime: 5 * 60 * 1000,
    enabled: isPending,
  });

  // Fetch feature categories + features for this market
  const { data: featureCatData = [] } = useQuery<FeatureCategoryWithFeatures[]>({
    queryKey: ["/api/markets", s.marketId, "feature-categories"],
    staleTime: 5 * 60 * 1000,
    enabled: isPending,
  });

  // On data load, pre-select category + subject based on original suggestion
  useEffect(() => {
    if (!isPending) return;

    if (isScore) {
      // Vendor evaluation — pre-select the criteria
      if (allCriteria.some(c => c.id === s.subjectId)) {
        setSelectedSubjectId(s.subjectId);
      }
    } else if (featureCatData.length > 0 && !selectedCategoryId) {
      // Find which category this feature belongs to
      for (const cat of featureCatData) {
        if (cat.features.some(f => f.id === s.subjectId)) {
          setEvalType(cat.isEcosystem ? "ecosystem_evaluation" : "product_evaluation");
          setSelectedCategoryId(cat.id);
          setSelectedSubjectId(s.subjectId);
          break;
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCriteria, featureCatData]);

  // Derived category lists
  const productCategories = featureCatData.filter(c => !c.isEcosystem);
  const ecosystemCategories = featureCatData.filter(c => c.isEcosystem);
  const activeCats = evalType === "product_evaluation" ? productCategories : ecosystemCategories;
  const selectedCat = activeCats.find(c => c.id === selectedCategoryId);

  // Group vendor criteria by category (execution / viability)
  const criteriaByCategory = allCriteria.reduce<Record<string, Criteria[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  const handleEvalTypeChange = (val: EvalType) => {
    setEvalType(val);
    setSelectedCategoryId("");
    setSelectedSubjectId("");
    setEditedValue("");
  };

  const handleCategoryChange = (val: string) => {
    setSelectedCategoryId(val);
    setSelectedSubjectId("");
    setEditedValue("");
  };

  const handleApprove = () => {
    if (!selectedSubjectId) return;
    const numVal = parseFloat(editedValue);
    if (isNaN(numVal)) return;
    onApprove(s.id, numVal, editedCommentary, selectedSubjectId, evalType);
  };

  const canApprove = !!selectedSubjectId && editedValue !== "" && !isNaN(parseFloat(editedValue));

  // Eval type badge for display (non-pending cards)
  const evalBadge = () => {
    if (isScore) {
      return (
        <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 gap-1 text-xs">
          <BarChart3 className="h-3 w-3" /> Vendor Evaluation
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50 gap-1 text-xs">
        <Layers className="h-3 w-3" /> Feature Support
      </Badge>
    );
  };

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardContent className="p-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start gap-2 flex-wrap">
          {evalBadge()}
          <Badge
            variant="outline"
            className={`text-xs gap-1 ${
              s.confidence === "HIGH"
                ? "text-orange-700 border-orange-300 bg-orange-50"
                : "text-gray-600 border-gray-300"
            }`}
          >
            {s.confidence === "HIGH" ? (
              <AlertCircle className="h-3 w-3" />
            ) : (
              <Lightbulb className="h-3 w-3" />
            )}
            {s.confidence} confidence
          </Badge>
          {!isPending && (
            <Badge
              variant="outline"
              className={`text-xs ${
                s.status === "approved"
                  ? "text-green-700 border-green-300 bg-green-50"
                  : "text-gray-500 border-gray-300"
              }`}
            >
              {s.status === "approved" ? "Approved" : "Rejected"}
            </Badge>
          )}
        </div>

        {/* Original subject info from AI */}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-0.5">AI identified subject</p>
          <p className="text-sm font-semibold text-gray-900">{s.subjectName}</p>
          {s.subjectCategory && (
            <p className="text-xs text-gray-500">{s.subjectCategory}</p>
          )}
          {currentVal != null && (
            <p className="text-xs text-gray-500 mt-1">
              Current score: <span className="font-semibold text-gray-800">{currentVal.toFixed(1)}</span>
            </p>
          )}
        </div>

        {/* AI Reasoning */}
        <div className="rounded bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">AI Reasoning</p>
          <p className="text-xs text-gray-700 leading-relaxed">{s.reasoning}</p>
        </div>

        {/* Source Signal — shown when a signal triggered this suggestion */}
        {s.sourceSignal && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-gray-500 flex items-center gap-1 hover:text-gray-700 list-none">
              <Radio className="h-3 w-3 text-cyan-500" />
              Source signal
              <span className="ml-auto text-[10px] text-gray-400 group-open:hidden">show</span>
              <span className="ml-auto text-[10px] text-gray-400 hidden group-open:inline">hide</span>
            </summary>
            <div className="mt-2 rounded border border-cyan-100 bg-cyan-50/40 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  s.sourceSignal.sourceType === "hackernews" ? "bg-orange-100 text-orange-700 border-orange-200" :
                  s.sourceSignal.sourceType === "reddit" ? "bg-red-100 text-red-700 border-red-200" :
                  s.sourceSignal.sourceType === "github" ? "bg-gray-100 text-gray-700 border-gray-200" :
                  "bg-amber-100 text-amber-700 border-amber-200"
                }`}>
                  {s.sourceSignal.sourceType === "hackernews" ? "HN" :
                   s.sourceSignal.sourceType.charAt(0).toUpperCase() + s.sourceSignal.sourceType.slice(1)}
                </span>
                {s.sourceSignal.sentiment && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    s.sourceSignal.sentiment.toUpperCase() === "POSITIVE" ? "bg-green-100 text-green-700 border-green-200" :
                    s.sourceSignal.sentiment.toUpperCase() === "NEGATIVE" ? "bg-red-100 text-red-700 border-red-200" :
                    "bg-gray-100 text-gray-600 border-gray-200"
                  }`}>
                    {s.sourceSignal.sentiment.charAt(0).toUpperCase() + s.sourceSignal.sentiment.slice(1).toLowerCase()}
                  </span>
                )}
                {s.sourceSignal.impactLabel && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                    s.sourceSignal.impactLabel.toUpperCase() === "HIGH" ? "bg-red-100 text-red-700 border-red-200" :
                    s.sourceSignal.impactLabel.toUpperCase() === "MEDIUM" ? "bg-amber-100 text-amber-700 border-amber-200" :
                    "bg-slate-100 text-slate-500 border-slate-200"
                  }`}>
                    {s.sourceSignal.impactLabel.toUpperCase()}
                  </span>
                )}
              </div>
              {s.sourceSignal.title && (
                <p className="text-xs font-medium text-gray-800 leading-snug">{s.sourceSignal.title}</p>
              )}
              {s.sourceSignal.content && (
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{s.sourceSignal.content}</p>
              )}
              {s.sourceSignal.url && (
                <a href={s.sourceSignal.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800">
                  <ExternalLink className="h-3 w-3" /> View source
                </a>
              )}
            </div>
          </details>
        )}

        {/* ── Review & edit section (pending only) ── */}
        {isPending && (
          <div className="space-y-4 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <Pencil className="h-3.5 w-3.5" />
              Select criteria to update
            </div>

            {/* Evaluation type */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Evaluation Type</Label>
              <Select value={evalType} onValueChange={(v) => handleEvalTypeChange(v as EvalType)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {EVAL_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">{o.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Vendor Evaluation — criteria picker */}
            {evalType === "vendor_evaluation" && (
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Criteria</Label>
                <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select criteria…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(criteriaByCategory).map(([cat, items]) => (
                      <div key={cat}>
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                          {cat}
                        </div>
                        {items.map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Product / Ecosystem Evaluation — category then feature */}
            {(evalType === "product_evaluation" || evalType === "ecosystem_evaluation") && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">Category</Label>
                  <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select category…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeCats.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-gray-400">No categories found</div>
                      ) : (
                        activeCats.map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {selectedCategoryId && (
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Feature</Label>
                    <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select feature…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedCat?.features ?? []).length === 0 ? (
                          <div className="px-2 py-2 text-xs text-gray-400">No features in this category</div>
                        ) : (
                          (selectedCat?.features ?? []).map(f => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {/* Score / Harvey Ball input — only shown once a subject is picked */}
            {selectedSubjectId && (
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">
                  {evalType === "vendor_evaluation" ? "New Score (0–10)" : "New Support Level"}
                </Label>
                {evalType === "vendor_evaluation" ? (
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={editedValue}
                    onChange={e => setEditedValue(e.target.value)}
                    placeholder="Enter score…"
                    className="w-32 h-8 text-sm"
                  />
                ) : (
                  <Select value={editedValue} onValueChange={setEditedValue}>
                    <SelectTrigger className="w-56 h-8 text-sm">
                      <SelectValue placeholder="Select level…" />
                    </SelectTrigger>
                    <SelectContent>
                      {HARVEY_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Commentary — always visible, pre-filled with AI suggestion */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Commentary</Label>
              <Textarea
                value={editedCommentary}
                onChange={e => setEditedCommentary(e.target.value)}
                rows={5}
                className="text-xs resize-y"
                placeholder="Commentary that will be saved…"
              />
              {s.currentCommentary && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                    Show current commentary
                  </summary>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed whitespace-pre-wrap border-l-2 border-gray-200 pl-2">
                    {s.currentCommentary}
                  </p>
                </details>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApprove}
                disabled={isMutating || !canApprove}
              >
                <CheckCircle className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                onClick={() => onReject(s.id)}
                disabled={isMutating}
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        )}

        {/* Approved — show what was reviewed */}
        {!isPending && s.status === "approved" && (
          <div className="border-t border-gray-100 pt-3 space-y-1">
            <p className="text-xs text-gray-400">
              Reviewed {s.reviewedAt ? new Date(s.reviewedAt).toLocaleDateString() : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Vendor group ─────────────────────────────────────────────────────────

function VendorGroup({
  vendorName,
  marketName,
  suggestions,
  onApprove,
  onReject,
  mutating,
}: {
  vendorName: string;
  marketName: string;
  suggestions: AiSuggestion[];
  onApprove: (id: string, value: number, commentary: string, overrideSubjectId: string, overrideEvalType: EvalType) => void;
  onReject: (id: string) => void;
  mutating: boolean;
}) {
  const pendingCount = suggestions.filter(s => s.status === "pending").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">{vendorName}</h3>
          <p className="text-xs text-gray-500">{marketName}</p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-amber-500 text-white text-xs">{pendingCount} pending</Badge>
        )}
      </div>
      <div className="space-y-3">
        {suggestions.map(s => (
          <SuggestionCard
            key={s.id}
            s={s}
            onApprove={onApprove}
            onReject={onReject}
            isMutating={mutating}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Promote Signal Modal ─────────────────────────────────────────────────

function PromoteSignalModal({
  signal,
  onClose,
  onPromoted,
}: {
  signal: SignalData;
  onClose: () => void;
  onPromoted: () => void;
}) {
  const { toast } = useToast();
  const [evalType, setEvalType] = useState<EvalType>("vendor_evaluation");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedSubjectName, setSelectedSubjectName] = useState("");
  const [selectedSubjectCategory, setSelectedSubjectCategory] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [commentary, setCommentary] = useState(
    [signal.title, signal.content].filter(Boolean).join("\n\n").slice(0, 800)
  );

  const { data: allCriteria = [] } = useQuery<Criteria[]>({ queryKey: ["/api/criteria"] });
  const { data: featureCatData = [] } = useQuery<FeatureCategoryWithFeatures[]>({
    queryKey: ["/api/markets", signal.marketId, "feature-categories"],
  });

  const criteriaByCategory = allCriteria.reduce<Record<string, Criteria[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  const productCats = featureCatData.filter(c => !c.isEcosystem);
  const ecosystemCats = featureCatData.filter(c => c.isEcosystem);
  const activeCats = evalType === "product_evaluation" ? productCats : ecosystemCats;
  const selectedCat = activeCats.find(c => c.id === selectedCategoryId);

  const handleEvalTypeChange = (v: EvalType) => {
    setEvalType(v);
    setSelectedCategoryId("");
    setSelectedSubjectId("");
    setSelectedSubjectName("");
    setSelectedSubjectCategory(null);
    setValue("");
  };

  const promoteMutation = useMutation({
    mutationFn: () =>
      apiRequestJson<{ suggestion: AiSuggestion }>(`/api/admin/vendor-signals/${signal.id}/promote`, "POST", {
        evalType,
        subjectId: selectedSubjectId,
        subjectName: selectedSubjectName,
        subjectCategory: selectedSubjectCategory,
        value: value !== "" ? parseFloat(value) : undefined,
        commentary,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions/count"] });
      toast({ title: "Suggestion created", description: "The signal has been promoted to a pending suggestion." });
      onPromoted();
    },
    onError: (err: any) =>
      toast({ title: "Promote failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = !!selectedSubjectId && value !== "" && !isNaN(parseFloat(value));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-auto max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b space-y-1">
          <h3 className="font-semibold text-gray-900">Promote Signal to Suggestion</h3>
          <p className="text-xs text-gray-500">
            Creates a pending suggestion from this signal. Fill in which criteria/feature to target and the proposed score.
          </p>
        </div>

        {/* Signal context */}
        <div className="px-5 pt-4 pb-2 rounded bg-gray-50 mx-5 mt-4 border text-xs space-y-1">
          <p className="font-semibold text-gray-700">Signal from {signal.vendorName}</p>
          <p className="text-gray-500 line-clamp-3">{signal.title}</p>
          <div className="flex gap-1.5 mt-1">
            {signal.sentiment && <span className="px-1.5 py-0.5 rounded border text-[10px] bg-gray-100 text-gray-600 border-gray-200">{signal.sentiment}</span>}
            {signal.impactLabel && <span className="px-1.5 py-0.5 rounded border text-[10px] bg-amber-50 text-amber-700 border-amber-200">{signal.impactLabel}</span>}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Eval type */}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">Evaluation Type</Label>
            <Select value={evalType} onValueChange={(v) => handleEvalTypeChange(v as EvalType)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVAL_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vendor Evaluation → criteria */}
          {evalType === "vendor_evaluation" && (
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Criteria</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={(v) => {
                  const c = allCriteria.find(c => c.id === v);
                  setSelectedSubjectId(v);
                  setSelectedSubjectName(c?.name ?? "");
                  setSelectedSubjectCategory(c?.category ?? null);
                }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select criteria…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(criteriaByCategory).map(([cat, items]) => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{cat}</div>
                      {items.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Product / Ecosystem → category + feature */}
          {(evalType === "product_evaluation" || evalType === "ecosystem_evaluation") && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Category</Label>
                <Select value={selectedCategoryId} onValueChange={(v) => {
                  setSelectedCategoryId(v);
                  setSelectedSubjectId("");
                  setSelectedSubjectName("");
                  setSelectedSubjectCategory(null);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCats.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedCategoryId && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">Feature</Label>
                  <Select
                    value={selectedSubjectId}
                    onValueChange={(v) => {
                      const f = selectedCat?.features.find(f => f.id === v);
                      setSelectedSubjectId(v);
                      setSelectedSubjectName(f?.name ?? "");
                      setSelectedSubjectCategory(selectedCat?.name ?? null);
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select feature…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedCat?.features ?? []).map(f => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {/* Score */}
          {selectedSubjectId && (
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">
                {evalType === "vendor_evaluation" ? "Proposed Score (0–10)" : "Proposed Support Level"}
              </Label>
              {evalType === "vendor_evaluation" ? (
                <Input type="number" min={0} max={10} step={0.1} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 7.5" className="w-32 h-8 text-sm" />
              ) : (
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="w-56 h-8 text-sm"><SelectValue placeholder="Select level…" /></SelectTrigger>
                  <SelectContent>
                    {HARVEY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Commentary */}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">Commentary (pre-seeded from signal)</Label>
            <Textarea value={commentary} onChange={e => setCommentary(e.target.value)} rows={4} className="text-xs resize-y" />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="outline" onClick={onClose} disabled={promoteMutation.isPending}>Cancel</Button>
            <Button
              size="sm"
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={() => promoteMutation.mutate()}
              disabled={!canSubmit || promoteMutation.isPending}
            >
              {promoteMutation.isPending ? "Creating…" : "Create Pending Suggestion"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signals sub-panel ────────────────────────────────────────────────────

const SIGNAL_SENTIMENTS = [
  { value: "all", label: "All Sentiments" },
  { value: "POSITIVE", label: "Positive" },
  { value: "NEGATIVE", label: "Negative" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "MIXED", label: "Mixed" },
] as const;

function SignalsPanel({ onSwitchToSuggestions }: { onSwitchToSuggestions?: () => void }) {
  const [vendorFilter, setVendorFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [promoteSignal, setPromoteSignal] = useState<SignalData | null>(null);

  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const signalsUrl = `/api/admin/vendor-signals?limit=50${
    vendorFilter !== "all" ? `&vendorId=${vendorFilter}` : ""
  }${marketFilter !== "all" ? `&marketId=${marketFilter}` : ""}${
    sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : ""
  }`;

  const { data: page, isLoading } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
  });

  // Sentiment filter is client-side (not yet a backend param)
  const signals = (page?.data ?? []).filter(
    s => sentimentFilter === "all" || (s.sentiment ?? "").toUpperCase() === sentimentFilter
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={marketFilter} onValueChange={setMarketFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All markets" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All markets</SelectItem>
            {markets.map(m => (
              <SelectItem key={m.id} value={m.id}>{m.name.replace(/^ITMAP for /i, "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All vendors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIGNAL_SOURCE_TYPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIGNAL_SENTIMENTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {page && (
          <span className="text-xs text-gray-400 ml-auto">{signals.length} of {page.total}</span>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-400 text-sm">Loading signals…</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          No signals found. Signals are collected every 12 hours or can be triggered via Signal Feed.
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map(s => (
            <SignalCard
              key={s.id}
              signal={s}
              showVendor
              onCreateSuggestion={setPromoteSignal}
            />
          ))}
        </div>
      )}

      {promoteSignal && (
        <PromoteSignalModal
          signal={promoteSignal}
          onClose={() => setPromoteSignal(null)}
          onPromoted={() => {
            setPromoteSignal(null);
            onSwitchToSuggestions?.();
          }}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function AiSuggestionsAdmin() {
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("suggestions");
  const [tab, setTab] = useState("pending");

  const { data: suggestions = [], isLoading } = useQuery<AiSuggestion[]>({
    queryKey: ["/api/admin/ai-suggestions", tab],
    queryFn: () =>
      fetch(`/api/admin/ai-suggestions?status=${tab === "all" ? "" : tab}`, {
        credentials: "include",
      }).then(r => r.json()),
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/ai-suggestions/count"],
  });

  const approveMutation = useMutation({
    mutationFn: ({
      id, value, commentary, overrideSubjectId, overrideEvalType,
    }: {
      id: string;
      value: number;
      commentary: string;
      overrideSubjectId: string;
      overrideEvalType: EvalType;
    }) =>
      apiRequest(`/api/admin/ai-suggestions/${id}/approve`, "POST", {
        value,
        commentary,
        overrideSubjectId,
        overrideEvalType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions/count"] });
      toast({ title: "Change approved and applied to the market data." });
    },
    onError: (err: any) =>
      toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/admin/ai-suggestions/${id}/reject`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions/count"] });
      toast({ title: "Suggestion rejected." });
    },
    onError: (err: any) =>
      toast({ title: "Reject failed", description: err.message, variant: "destructive" }),
  });

  const mutating = approveMutation.isPending || rejectMutation.isPending;

  const grouped = suggestions.reduce<Record<string, AiSuggestion[]>>((acc, s) => {
    if (!acc[s.vendorId]) acc[s.vendorId] = [];
    acc[s.vendorId].push(s);
    return acc;
  }, {});

  const pendingCount = countData?.count ?? 0;

  return (
    <div className="space-y-6">
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="suggestions" className="gap-2">
            Suggestions
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="signals" className="gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            All Signals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="suggestions" className="mt-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">AI Market Suggestions</h2>
              <p className="text-sm text-gray-500 mt-1">
                After each news scrape, the AI proposes commentary changes for admin review.
                Select the evaluation type and criteria to update, enter the new score, and approve.
              </p>
            </div>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white text-sm px-3 py-1 shrink-0">
                {pendingCount} pending
              </Badge>
            )}
          </div>

          {/* Info banner */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-1">
            <p className="font-semibold">How this works</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700 text-xs">
              <li>Suggestions are generated automatically after the daily news scrape (7 AM UTC).</li>
              <li>The AI proposes commentary only — you decide which criteria/feature to update and what score to assign.</li>
              <li>Use the dropdowns to select Vendor Evaluation, Product Evaluation, or Ecosystem Evaluation, then pick the category and criteria.</li>
              <li>Enter a new score and edit the commentary before approving — changes apply immediately.</li>
              <li>Rejecting discards the suggestion with no changes to live data.</li>
            </ul>
          </div>

          {/* Status tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="pending" className="gap-2">
                Pending
                {pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {pendingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>

            {["pending", "approved", "rejected", "all"].map(tabVal => (
              <TabsContent key={tabVal} value={tabVal} className="mt-6">
                {isLoading ? (
                  <div className="text-center py-12 text-gray-500">Loading suggestions…</div>
                ) : Object.keys(grouped).length === 0 ? (
                  <div className="text-center py-12">
                    <Lightbulb className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">
                      {tabVal === "pending"
                        ? "No pending suggestions. They appear here after the next news scrape."
                        : `No ${tabVal} suggestions.`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(grouped).map(([vendorId, vendorSuggestions]) => (
                      <VendorGroup
                        key={vendorId}
                        vendorName={vendorSuggestions[0].vendorName}
                        marketName={vendorSuggestions[0].marketName}
                        suggestions={vendorSuggestions}
                        onApprove={(id, value, commentary, overrideSubjectId, overrideEvalType) =>
                          approveMutation.mutate({ id, value, commentary, overrideSubjectId, overrideEvalType })
                        }
                        onReject={id => rejectMutation.mutate(id)}
                        mutating={mutating}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        <TabsContent value="signals" className="mt-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">All Signals</h2>
              <p className="text-sm text-gray-500 mt-1">
                Browse every collected signal regardless of whether it generated a suggestion. Use "Create Suggestion" to manually promote any signal to a pending suggestion.
              </p>
            </div>
            <SignalsPanel
              onSwitchToSuggestions={() => {
                setMainTab("suggestions");
                setTab("pending");
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
