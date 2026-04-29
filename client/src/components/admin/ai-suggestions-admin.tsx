import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  AlertCircle,
  BarChart3,
  Layers,
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

// ─── Harvey Ball label ────────────────────────────────────────────────────

const HARVEY_LABELS: Record<number, string> = {
  0: "Not Supported",
  1: "Limited (25%)",
  2: "Partial (50%)",
  3: "Good (75%)",
  4: "Full Support (100%)",
};

// ─── Score delta indicator ────────────────────────────────────────────────

function ScoreDelta({ current, suggested, type }: { current: number; suggested: number; type: "criterion_score" | "feature_support" }) {
  const delta = suggested - current;
  const isUp = delta > 0;
  const isDown = delta < 0;

  const formatVal = (v: number) =>
    type === "criterion_score" ? v.toFixed(1) : HARVEY_LABELS[v] ?? String(v);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm text-gray-500 font-medium">
        Current: <span className="text-gray-800 font-semibold">{formatVal(current)}</span>
      </span>
      <span className="text-gray-400">→</span>
      <span className="text-sm font-medium">
        Suggested:{" "}
        <span className={`font-bold ${isUp ? "text-green-700" : isDown ? "text-red-700" : "text-gray-700"}`}>
          {formatVal(suggested)}
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
      {!isUp && !isDown && <Minus className="h-4 w-4 text-gray-400" />}
    </div>
  );
}

// ─── Commentary diff ──────────────────────────────────────────────────────

function CommentaryDiff({ current, suggested }: { current: string | null; suggested: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!suggested) return null;

  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} commentary changes
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded border border-red-200 bg-red-50 p-3">
            <div className="text-xs font-semibold text-red-700 mb-1">Current</div>
            <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
              {current ?? "(no current commentary)"}
            </p>
          </div>
          <div className="rounded border border-green-200 bg-green-50 p-3">
            <div className="text-xs font-semibold text-green-700 mb-1">Proposed</div>
            <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{suggested}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single suggestion card ───────────────────────────────────────────────

function SuggestionCard({
  s,
  onApprove,
  onReject,
  isPending,
}: {
  s: AiSuggestion;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}) {
  const current = s.currentValue != null ? parseFloat(s.currentValue) : null;
  const suggested = s.suggestedValue != null ? parseFloat(s.suggestedValue) : null;
  const isScore = s.suggestionType === "criterion_score";

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
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
              className={`text-xs gap-1 ${s.confidence === "HIGH" ? "text-orange-700 border-orange-300 bg-orange-50" : "text-gray-600 border-gray-300"}`}
            >
              {s.confidence === "HIGH" ? <AlertCircle className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />}
              {s.confidence} confidence
            </Badge>
            {s.status !== "pending" && (
              <Badge
                variant="outline"
                className={`text-xs ${s.status === "approved" ? "text-green-700 border-green-300 bg-green-50" : "text-gray-500 border-gray-300"}`}
              >
                {s.status === "approved" ? "Approved" : "Rejected"}
              </Badge>
            )}
          </div>
        </div>

        {/* Subject */}
        <div>
          <p className="text-sm font-semibold text-gray-900">{s.subjectName}</p>
          {s.subjectCategory && (
            <p className="text-xs text-gray-500">{s.subjectCategory}</p>
          )}
        </div>

        {/* Score delta */}
        {current != null && suggested != null && (
          <ScoreDelta current={current} suggested={suggested} type={s.suggestionType} />
        )}

        {/* Commentary diff */}
        <CommentaryDiff current={s.currentCommentary} suggested={s.suggestedCommentary} />

        {/* Reasoning */}
        <div className="rounded bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">AI Reasoning</p>
          <p className="text-xs text-gray-700 leading-relaxed">{s.reasoning}</p>
        </div>

        {/* Actions */}
        {s.status === "pending" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="gap-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onApprove(s.id)}
              disabled={isPending}
            >
              <CheckCircle className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => onReject(s.id)}
              disabled={isPending}
            >
              <XCircle className="h-3.5 w-3.5" /> Reject
            </Button>
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
  onApprove: (id: string) => void;
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
      <div className="space-y-2 pl-0">
        {suggestions.map(s => (
          <SuggestionCard
            key={s.id}
            s={s}
            onApprove={onApprove}
            onReject={onReject}
            isPending={mutating}
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
      fetch(`/api/admin/ai-suggestions?status=${tab === "all" ? "" : tab}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/ai-suggestions/count"],
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/ai-suggestions/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions/count"] });
      toast({ title: "Change approved and applied to the market data." });
    },
    onError: (err: any) => toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/ai-suggestions/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-suggestions/count"] });
      toast({ title: "Suggestion rejected." });
    },
    onError: (err: any) => toast({ title: "Reject failed", description: err.message, variant: "destructive" }),
  });

  const mutating = approveMutation.isPending || rejectMutation.isPending;

  // Group by vendor
  const grouped = suggestions.reduce<Record<string, AiSuggestion[]>>((acc, s) => {
    const key = s.vendorId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
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
            After each news scrape, the AI reviews new articles and proposes specific score and
            commentary changes. Review and approve or reject each one before changes go live.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-amber-500 text-white text-sm px-3 py-1 shrink-0">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">How this works</p>
        <ul className="list-disc list-inside space-y-0.5 text-blue-700 text-xs">
          <li>Suggestions are generated automatically after each daily news scrape (7 AM UTC).</li>
          <li><strong>Vendor Evaluation</strong> score changes are only proposed for HIGH or MEDIUM impact news with direct evidence.</li>
          <li><strong>Feature support</strong> changes are only proposed when an article explicitly describes a new or upgraded capability.</li>
          <li>Commentary shows the full updated text — the AI integrates the news as a concise addendum, trimming dated content if needed.</li>
          <li>Approving applies the change immediately to the live market data. Rejecting discards it with no changes.</li>
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
                    onApprove={id => approveMutation.mutate(id)}
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
