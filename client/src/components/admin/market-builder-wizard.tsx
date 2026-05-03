import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle2, Circle, Loader2, AlertCircle, ChevronRight,
  Building2, Layers, BarChart3, Grid3X3, Wand2, Trash2, RotateCcw,
  Eye, ExternalLink, Sparkles,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

interface MarketBuilderJob {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "published";
  inputName: string;
  inputDescription: string;
  inputCategory: string | null;
  inputContext: string | null;
  marketId: string | null;
  error: string | null;
  createdAt: string;
  stages?: MarketBuilderStage[];
}

interface MarketBuilderStage {
  id: string;
  jobId: string;
  stage: number;
  status: "pending" | "running" | "completed" | "failed";
  result: any;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface SSEEvent {
  type: string;
  stage?: number;
  label?: string;
  summary?: string;
  message?: string;
  result?: any;
  error?: string;
  jobId?: string;
}

// ── Stage metadata ────────────────────────────────────────────────────────

const STAGES = [
  { num: 1, label: "Vendors",          icon: Building2,  description: "Identifying vendors in this market" },
  { num: 2, label: "Criteria",         icon: BarChart3,  description: "Defining evaluation criteria & weights" },
  { num: 3, label: "Feature Matrix",   icon: Grid3X3,    description: "Building feature categories & features" },
  { num: 4, label: "Scoring",          icon: BarChart3,  description: "Scoring vendors against criteria" },
  { num: 5, label: "Feature Support",  icon: Layers,     description: "Evaluating Harvey Ball support levels" },
];

const CATEGORIES = [
  "Cloud & Infrastructure", "Security & Identity", "Data & Analytics",
  "AI & Machine Learning", "DevOps & Platform", "Collaboration & Productivity",
  "Storage & Backup", "Networking", "Database", "ERP & Business Applications",
  "CRM & Marketing", "Other",
];

// ── Stage progress indicator ───────────────────────────────────────────────

function StageProgress({
  stages,
  activeStage,
  summaries,
}: {
  stages: typeof STAGES;
  activeStage: number;
  summaries: Record<number, string>;
}) {
  return (
    <div className="space-y-2">
      {stages.map(({ num, label, icon: Icon, description }) => {
        const done = activeStage > num;
        const running = activeStage === num;
        const pending = activeStage < num;
        return (
          <div
            key={num}
            className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
              running ? "bg-blue-50 border border-blue-200" :
              done ? "bg-green-50" : "bg-gray-50"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : running ? (
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
              ) : (
                <Circle className="h-5 w-5 text-gray-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${
                  done ? "text-green-800" : running ? "text-blue-800" : "text-gray-400"
                }`}>
                  {num}. {label}
                </span>
                {running && (
                  <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs py-0">
                    Running
                  </Badge>
                )}
              </div>
              <p className={`text-xs mt-0.5 ${done ? "text-green-600" : running ? "text-blue-600" : "text-gray-400"}`}>
                {summaries[num] ?? description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Results preview ───────────────────────────────────────────────────────

function ResultsAccordion({ stageResults }: { stageResults: Record<number, any> }) {
  const completedStages = Object.keys(stageResults).map(Number).sort();
  if (completedStages.length === 0) return null;

  return (
    <Accordion type="multiple" className="space-y-2">
      {completedStages.includes(1) && stageResults[1] && (
        <AccordionItem value="stage1" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              Vendors ({stageResults[1].vendors?.length ?? 0})
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">{stageResults[1].marketSummary}</p>
            <div className="space-y-1.5">
              {stageResults[1].vendors?.map((v: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium text-gray-800">{v.name}</span>
                    <span className="text-gray-500"> — {v.product}</span>
                    <p className="text-gray-500 mt-0.5">{v.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {completedStages.includes(2) && stageResults[2] && (
        <AccordionItem value="stage2" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              Criteria ({stageResults[2].criteria?.length ?? 0})
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-1.5">
            {["execution", "viability"].map(axis => (
              <div key={axis} className="mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  {axis} axis
                </p>
                <div className="space-y-1">
                  {stageResults[2].criteria
                    ?.filter((c: any) => c.category === axis)
                    .map((c: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="font-medium text-gray-800 shrink-0">{c.name}</span>
                        <span className="text-gray-400">·</span>
                        <span className="text-gray-500">{c.description}</span>
                        <Badge variant="outline" className="text-xs py-0 ml-auto shrink-0">
                          w={c.weight}
                        </Badge>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      {completedStages.includes(3) && stageResults[3] && (
        <AccordionItem value="stage3" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              Feature Matrix ({stageResults[3].categories?.reduce(
                (s: number, c: any) => s + c.features.length, 0
              ) ?? 0} features)
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-3">
            {stageResults[3].categories?.map((cat: any, i: number) => (
              <div key={i}>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold text-gray-700">{cat.name}</p>
                  {cat.isEcosystem && (
                    <Badge variant="outline" className="text-purple-700 border-purple-200 text-xs py-0">
                      Ecosystem
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {cat.features.map((f: any, j: number) => (
                    <span key={j} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      {completedStages.includes(4) && stageResults[4] && (
        <AccordionItem value="stage4" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              Vendor Scores ({stageResults[4].scores?.length ?? 0} scores)
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {stageResults[4].scores?.slice(0, 30).map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700 font-medium">{s.vendorName}</span>
                  <span className="text-gray-400 mx-2 truncate max-w-[140px]">{s.criterionName}</span>
                  <Badge variant="outline" className={`text-xs py-0 shrink-0 ${
                    s.score >= 8 ? "text-green-700 border-green-300" :
                    s.score >= 6 ? "text-blue-700 border-blue-300" :
                    "text-gray-500 border-gray-300"
                  }`}>
                    {s.score.toFixed(1)}
                  </Badge>
                </div>
              ))}
              {(stageResults[4].scores?.length ?? 0) > 30 && (
                <p className="text-xs text-gray-400 text-center pt-1">
                  +{stageResults[4].scores.length - 30} more scores…
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {completedStages.includes(5) && stageResults[5] && (
        <AccordionItem value="stage5" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              Feature Support ({stageResults[5].support?.length ?? 0} records)
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <p className="text-xs text-gray-500">
              {stageResults[5].support?.length ?? 0} Harvey Ball support records generated across all vendors and features.
            </p>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}

// ── Previous jobs list ────────────────────────────────────────────────────

function PreviousJobs({
  jobs,
  onResume,
  onDelete,
}: {
  jobs: MarketBuilderJob[];
  onResume: (job: MarketBuilderJob) => void;
  onDelete: (id: string) => void;
}) {
  if (jobs.length === 0) return null;

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-700 border-green-300 bg-green-50";
      case "published": return "text-blue-700 border-blue-300 bg-blue-50";
      case "running":   return "text-amber-700 border-amber-300 bg-amber-50";
      case "failed":    return "text-red-700 border-red-300 bg-red-50";
      default:          return "text-gray-600 border-gray-300";
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Previous Jobs</p>
      <div className="space-y-2">
        {jobs.map(job => (
          <div key={job.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 truncate">{job.inputName}</span>
                <Badge variant="outline" className={`text-xs py-0 ${statusColor(job.status)}`}>
                  {job.status}
                </Badge>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(job.createdAt).toLocaleDateString()} · {job.inputCategory ?? "No category"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {job.status === "published" && job.marketId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => window.open(`/markets/${job.marketId}`, "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              {(job.status === "completed" || job.status === "failed" || job.status === "idle") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => onResume(job)}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resume
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-red-500 hover:text-red-700"
                onClick={() => onDelete(job.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────

type WizardView = "form" | "streaming" | "review" | "published";

export function MarketBuilderWizard() {
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");

  // Job state
  const [activeJob, setActiveJob] = useState<MarketBuilderJob | null>(null);
  const [view, setView] = useState<WizardView>("form");

  // SSE state
  const [activeStage, setActiveStage] = useState(0);
  const [stageSummaries, setStageSummaries] = useState<Record<number, string>>({});
  const [stageResults, setStageResults] = useState<Record<number, any>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Published market ID
  const [publishedMarketId, setPublishedMarketId] = useState<string | null>(null);

  // Previous jobs
  const { data: jobs = [], refetch: refetchJobs } = useQuery<MarketBuilderJob[]>({
    queryKey: ["/api/admin/market-builder/jobs"],
  });

  // Create job mutation
  const createJob = useMutation({
    mutationFn: (data: { inputName: string; inputDescription: string; inputCategory?: string; inputContext?: string; createdBy?: string }) =>
      apiRequest("/api/admin/market-builder/jobs", "POST", data).then(r => r.json()),
    onSuccess: (job: MarketBuilderJob) => {
      setActiveJob(job);
      setView("streaming");
      setActiveStage(1);
      setStageSummaries({});
      setStageResults({});
      setStreamError(null);
      setProgressMsg("");
      refetchJobs();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create job", description: err.message, variant: "destructive" });
    },
  });

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: (jobId: string) =>
      apiRequest(`/api/admin/market-builder/jobs/${jobId}/publish`, "POST").then(r => r.json()),
    onSuccess: (data: any) => {
      setPublishedMarketId(data.marketId);
      setView("published");
      refetchJobs();
      toast({ title: "Market published!", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "Publish failed", description: err.message, variant: "destructive" });
    },
  });

  // Delete job mutation
  const deleteJob = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/market-builder/jobs/${id}`, "DELETE"),
    onSuccess: () => refetchJobs(),
  });

  // Open SSE stream for a job
  const startStream = useCallback((job: MarketBuilderJob) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource(`/api/admin/market-builder/jobs/${job.id}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);

        switch (event.type) {
          case "job_start":
            setActiveStage(1);
            break;

          case "stage_start":
            setActiveStage(event.stage!);
            setProgressMsg("");
            break;

          case "stage_progress":
            setProgressMsg(event.message ?? "");
            break;

          case "stage_complete":
          case "stage_skipped":
            setStageResults(prev => ({ ...prev, [event.stage!]: event.result }));
            setStageSummaries(prev => ({ ...prev, [event.stage!]: event.summary ?? event.label ?? "" }));
            setActiveStage(prev => Math.max(prev, event.stage! + 1));
            setProgressMsg("");
            break;

          case "stage_error":
            setStreamError(`Stage ${event.stage} failed: ${event.error}`);
            es.close();
            break;

          case "job_complete":
            setActiveStage(6); // past all stages
            setView("review");
            es.close();
            refetchJobs();
            break;

          case "job_error":
            setStreamError(event.error ?? "Unknown error");
            es.close();
            refetchJobs();
            break;
        }
      } catch (err) {
        console.error("[MarketBuilder] SSE parse error:", err);
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStreamError("Connection lost. You can resume the job from the previous jobs list.");
      es.close();
      refetchJobs();
    };
  }, [refetchJobs]);

  // Auto-start stream when we enter streaming view
  useEffect(() => {
    if (view === "streaming" && activeJob) {
      startStream(activeJob);
    }
    return () => {
      eventSourceRef.current?.close();
    };
  }, [view, activeJob, startStream]);

  // Resume a previous job
  const handleResume = (job: MarketBuilderJob) => {
    setActiveJob(job);
    setView("streaming");
    setActiveStage(1);
    setStageSummaries({});
    setStageResults({});
    setStreamError(null);
    setProgressMsg("");
  };

  // Submit form
  const handleSubmit = () => {
    if (!name.trim() || !description.trim()) {
      toast({ title: "Please fill in the market name and description", variant: "destructive" });
      return;
    }
    createJob.mutate({
      inputName: name.trim(),
      inputDescription: description.trim(),
      inputCategory: category || undefined,
      inputContext: context.trim() || undefined,
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <Wand2 className="h-5 w-5 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-900">AI Market Builder</h2>
          <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">
            Beta
          </Badge>
        </div>
        <p className="text-sm text-gray-500">
          Describe a technology market and the AI will generate a complete vendor evaluation — vendors, criteria, feature matrix, scores, and support levels.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">How it works</p>
        <ul className="list-disc list-inside space-y-0.5 text-blue-700 text-xs">
          <li>5 AI stages run sequentially — each takes 10–30 seconds.</li>
          <li>Progress is saved after every stage — closing the browser is safe.</li>
          <li>Review the results before publishing. The market is hidden by default.</li>
          <li>After publishing, edit any data in the normal admin tabs.</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: form or progress */}
        <div className="lg:col-span-1 space-y-4">

          {/* Form */}
          {view === "form" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New Market</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Market Name *</Label>
                  <Input
                    placeholder="e.g. Enterprise Object Storage"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Description *</Label>
                  <Textarea
                    placeholder="Describe the market — what technology does it cover, who are the buyers, what problem does it solve?"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={4}
                    className="text-sm resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select a category…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Extra context <span className="text-gray-400">(optional)</span></Label>
                  <Textarea
                    placeholder="Any additional context — specific vendors to include, regional focus, buyer segment, etc."
                    value={context}
                    onChange={e => setContext(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>

                <Button
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
                  onClick={handleSubmit}
                  disabled={createJob.isPending}
                >
                  {createJob.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Start Building
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Progress tracker */}
          {(view === "streaming" || view === "review") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{activeJob?.inputName}</span>
                  {view === "streaming" && (
                    <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Running
                    </Badge>
                  )}
                  {view === "review" && (
                    <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Complete
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <StageProgress
                  stages={STAGES}
                  activeStage={activeStage}
                  summaries={stageSummaries}
                />

                {progressMsg && (
                  <p className="text-xs text-blue-600 italic">{progressMsg}</p>
                )}

                {streamError && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                    <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{streamError}</p>
                  </div>
                )}

                {view === "review" && !streamError && (
                  <div className="space-y-2 pt-1 border-t border-gray-100">
                    <p className="text-xs text-gray-600">
                      All stages complete. Review the results on the right, then publish when ready.
                    </p>
                    <Button
                      className="w-full gap-2 bg-green-600 hover:bg-green-700"
                      onClick={() => publishMutation.mutate(activeJob!.id)}
                      disabled={publishMutation.isPending}
                    >
                      {publishMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Publish Market
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => { setView("form"); setActiveJob(null); }}
                    >
                      Start a new market
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Published state */}
          {view === "published" && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6 space-y-4">
                <div className="text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-2" />
                  <p className="font-semibold text-green-800">Market Created!</p>
                  <p className="text-xs text-green-700 mt-1">
                    The market is hidden by default. Make it visible from the Markets tab.
                  </p>
                </div>
                <div className="space-y-2">
                  {publishedMarketId && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-xs"
                      onClick={() => window.open(`/markets/${publishedMarketId}`, "_blank")}
                    >
                      <Eye className="h-3.5 w-3.5" /> Preview Market
                    </Button>
                  )}
                  <Button
                    className="w-full text-xs gap-2 bg-blue-600 hover:bg-blue-700"
                    onClick={() => {
                      setView("form");
                      setActiveJob(null);
                      setName(""); setDescription(""); setCategory(""); setContext("");
                      setPublishedMarketId(null);
                    }}
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Build Another Market
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Previous jobs */}
          <PreviousJobs
            jobs={jobs.filter(j => j.id !== activeJob?.id)}
            onResume={handleResume}
            onDelete={id => deleteJob.mutate(id)}
          />
        </div>

        {/* Right: results */}
        <div className="lg:col-span-2">
          {view === "form" && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 text-center text-gray-400 space-y-3 border-2 border-dashed border-gray-200 rounded-xl">
              <Wand2 className="h-10 w-10 text-gray-300" />
              <div>
                <p className="font-medium text-gray-500">Fill in the form and click Start Building</p>
                <p className="text-xs mt-1">AI results will appear here as each stage completes</p>
              </div>
            </div>
          )}

          {(view === "streaming" || view === "review" || view === "published") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">AI-Generated Results</CardTitle>
                {view === "streaming" && (
                  <p className="text-xs text-gray-400">Results appear as each stage completes…</p>
                )}
              </CardHeader>
              <CardContent>
                {Object.keys(stageResults).length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for first stage to complete…
                  </div>
                ) : (
                  <ResultsAccordion stageResults={stageResults} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
