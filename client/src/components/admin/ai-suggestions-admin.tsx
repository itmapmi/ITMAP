import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  TrendingUp,
  TrendingDown,
  Lightbulb,
  AlertCircle,
  BarChart3,
  Layers,
  Pencil,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────

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
}

// ─── Harvey Ball labels ───────────────────────────────────────────────────

const HARVEY_OPTIONS = [
  { value: "0", label: "0 — Not Supported" },
  { value: "1", label: "1 — Limited (25%)" },
  { value: "2", label: "2 — Partial (50%)" },
  { value: "3", label: "3 — Good (75%)" },
  { value: "4", label: "4 — Full Support (100%)" },
];

const harveyLabel = (v: number) =>
  HARVEY_OPTIONS.find(o => o.value === String(v))?.label ?? String(v);

// ─── Score delta indicator ────────────────────────────────────────────────

function ScoreDelta({
  current,
  suggested,
  type,
}: {
  current: number;
  suggested: number;
  type: "criterion_score" | "feature_support";
}) {
  const delta = suggested - current;
  const isUp = delta > 0;
  const isDown = delta < 0;
  const fmt = (v: number) =>
    type === "criterion_score" ? v.toFixed(1) : harveyLabel(v);

  return (
    <div className="flex items-center gap-3 flex-wrap text-sm">
      <span className="text-gray-500">
        Current: <span className="font-semibold text-gray-800">{fmt(current)}</span>
      </span>
      <span className="text-gray-400">→</span>
      <span className="text-gray-500">
        AI suggests:{" "}
        <span className={`font-bold ${isUp ? "text-green-700" : isDown ? "text-red-700" : "text-gray-700"}`}>
          {fmt(suggested)}
        </span>
      </span>
      {isUp && (
        <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs gap-1">
          <TrendingUp className="h-3 w-3" /> +{type === "criterion_score" ? delta.toFixed(1) : delta}
        </Badge>
      )}
      {isDown && (
        <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 text-xs gap-1">
          <TrendingDown className="h-3 w-3" /> {type === "criterion_score" ? delta.toFixed(1) : delta}
        </Badge>
      )}
    </div>
  );
}

// ─── Single suggestion card ───────────────────────────────────────────────

function SuggestionCard({
  s,
  onApprove,
  onReject,
  isMutating,
}: {
  s: AiSuggestion;
  onApprove: (id: string, value: number, commentary: string) => void;
  onReject: (id: string) => void;
  isMutating: boolean;
}) {
  const aiValue =
    s.suggestedValue != null ? parseFloat(s.suggestedValue) : null;
  const currentVal =
    s.currentValue != null ? parseFloat(s.currentValue) : null;
  const isScore = s.suggestionType === "criterion_score";

  // Editable local state — pre-filled with AI suggestion
  const [editedValue, setEditedValue] = useState<string>(
    aiValue != null ? String(isScore ? aiValue.toFixed(1) : Math.round(aiValue)) : ""
  );
  const [editedCommentary, setEditedCommentary] = useState<string>(
    s.suggestedCommentary ?? ""
  );

  const handleApprove = () => {
    const numVal = parseFloat(editedValue);
    if (isNaN(numVal)) return;
    onApprove(s.id, numVal, editedCommentary);
  };

  const isPending = s.status === "pending";

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardContent className="p-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start gap-2 flex-wrap">
          {isScore ? (
            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 gap-1 text-xs">
              <BarChart3 className="h-3 w-3" /> Vendor Evaluation
            </Badge>
          ) : (
            <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50 gap-1 text-xs">
              <Layers className="h-3 w-3" /> Feature Support
            </Badge>
          )}
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

        {/* Subject */}
        <div>
          <p className="text-sm font-semibold text-gray-900">{s.subjectName}</p>
          {s.subjectCategory && (
            <p className="text-xs text-gray-500">{s.subjectCategory}</p>
          )}
        </div>

        {/* Original score delta */}
        {currentVal != null && aiValue != null && (
          <ScoreDelta current={currentVal} suggested={aiValue} type={s.suggestionType} />
        )}

        {/* AI Reasoning */}
        <div className="rounded bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">AI Reasoning</p>
          <p className="text-xs text-gray-700 leading-relaxed">{s.reasoning}</p>
        </div>

        {/* ── Editable fields (pending only) ── */}
        {isPending && (
          <div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1">
              <Pencil className="h-3.5 w-3.5" />
              Review & edit before approving
            </div>

            {/* Score editor */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">
                {isScore ? "Score (0–10)" : "Support Level"}
              </Label>
              {isScore ? (
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={editedValue}
                  onChange={e => setEditedValue(e.target.value)}
                  className="w-28 h-8 text-sm"
                />
              ) : (
                <Select value={editedValue} onValueChange={setEditedValue}>
                  <SelectTrigger className="w-56 h-8 text-sm">
                    <SelectValue placeholder="Select level" />
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

            {/* Commentary editor */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Commentary</Label>
              <Textarea
                value={editedCommentary}
                onChange={e => setEditedCommentary(e.target.value)}
                rows={5}
                className="text-xs resize-y"
                placeholder="Commentary that will be saved with this score…"
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
                disabled={isMutating || editedValue === ""}
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

        {/* Approved — show what was actually saved */}
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
  onApprove: (id: string, value: number, commentary: string) => void;
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

// ─── Main component ───────────────────────────────────────────────────────

export function AiSuggestionsAdmin() {
  const { toast } = useToast();
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
    mutationFn: ({ id, value, commentary }: { id: string; value: number; commentary: string }) =>
      apiRequest("POST", `/api/admin/ai-suggestions/${id}/approve`, { value, commentary }),
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
      apiRequest("POST", `/api/admin/ai-suggestions/${id}/reject`),
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">AI Market Suggestions</h2>
          <p className="text-sm text-gray-500 mt-1">
            After each news scrape, the AI proposes score and commentary changes for admin review.
            Edit the values before approving, or reject to discard.
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
          <li>Only HIGH or MEDIUM impact articles trigger criterion score changes.</li>
          <li>Feature support changes require an article explicitly describing a new capability.</li>
          <li>You can edit the score and commentary before approving — changes apply immediately.</li>
          <li>Rejecting discards the suggestion with no changes to live data.</li>
        </ul>
      </div>

      {/* Tabs */}
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
                    onApprove={(id, value, commentary) =>
                      approveMutation.mutate({ id, value, commentary })
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
    </div>
  );
}
