import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  TrendingUp,
  Calendar,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  BarChart3,
  Trash2,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ForecastStatus =
  | "draft"
  | "boundary_confirmed"
  | "brief_complete"
  | "debate_complete"
  | "calculating"
  | "complete";

type ForecastRow = {
  id: string;
  title: string;
  status: ForecastStatus;
  baseYear: number | null;
  forecastHorizonYears: number | null;
  confidenceBand: string | null;
  createdAt: string;
  updatedAt: string;
  versionNumber: number;
  auditEventCount: number;
};

const STATUS_CONFIG: Record<ForecastStatus, { label: string; cls: string; Icon: any }> = {
  draft:               { label: "Draft",            cls: "bg-slate-800 text-slate-300 border border-white/10",     Icon: Clock },
  boundary_confirmed:  { label: "Boundary Set",     cls: "bg-cyan-950 text-cyan-300 border border-cyan-500/20",    Icon: CheckCircle2 },
  brief_complete:      { label: "Brief Complete",   cls: "bg-violet-950 text-violet-300 border border-violet-500/20", Icon: CheckCircle2 },
  debate_complete:     { label: "Debate Complete",  cls: "bg-blue-950 text-blue-300 border border-blue-500/20",    Icon: CheckCircle2 },
  calculating:         { label: "Calculating",      cls: "bg-amber-950 text-amber-300 border border-amber-500/20", Icon: Loader2 },
  complete:            { label: "Complete",         cls: "bg-emerald-950 text-emerald-300 border border-emerald-500/20", Icon: CheckCircle2 },
};

function StatusBadge({ status }: { status: ForecastStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const { Icon, label, cls } = cfg;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${status === "calculating" ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

export default function ForecastBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: forecasts = [], isLoading } = useQuery<ForecastRow[]>({
    queryKey: ["/api/forecast-builder/forecasts"],
  });

  const createMutation = useMutation({
    mutationFn: (title: string) =>
      apiRequestJson("/api/forecast-builder/forecasts", "POST", { title }),
    onSuccess: async (data: ForecastRow) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts"] });
      setNewDialogOpen(false);
      setNewTitle("");
      toast({ title: "Forecast created", description: data.title });
      setLocation(`/forecast-builder/${data.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create forecast", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/forecast-builder/forecasts/${id}`, "DELETE"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts"] });
      setDeleteId(null);
      toast({ title: "Forecast deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Forecast Builder</h1>
            </div>
            <p className="text-slate-400 text-sm mt-1 max-w-xl">
              AI-native market forecasting with structured multi-LLM debate, primary-data construction,
              and fully auditable assumptions.
            </p>
          </div>
          <Button
            onClick={() => setNewDialogOpen(true)}
            className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 font-medium"
          >
            <Plus className="h-4 w-4 mr-2" /> New Forecast
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { label: "Total Forecasts", value: forecasts.length, Icon: BarChart3 },
            { label: "Complete", value: forecasts.filter(f => f.status === "complete").length, Icon: CheckCircle2 },
            { label: "In Progress", value: forecasts.filter(f => f.status !== "complete" && f.status !== "draft").length, Icon: Loader2 },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="bg-slate-900 border border-white/5 rounded-xl p-5">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
              <p className="text-2xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        {/* Forecast list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
          </div>
        ) : forecasts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-900 border border-white/5 flex items-center justify-center mb-4">
              <TrendingUp className="h-8 w-8 text-slate-600" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No forecasts yet</h3>
            <p className="text-slate-400 text-sm max-w-sm mb-6">
              Create your first AI-powered market forecast. Define scope, run a structured debate,
              and get defensible numbers your board can trust.
            </p>
            <Button
              onClick={() => setNewDialogOpen(true)}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
            >
              <Plus className="h-4 w-4 mr-2" /> New Forecast
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {forecasts.map(forecast => (
              <div
                key={forecast.id}
                className="group bg-slate-900 border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <StatusBadge status={forecast.status} />
                      {forecast.confidenceBand && (
                        <span className="text-xs text-slate-500 capitalize">{forecast.confidenceBand}</span>
                      )}
                      <span className="text-[10px] text-slate-600 bg-slate-800/60 border border-white/5 px-1.5 py-0.5 rounded font-mono">
                        v{forecast.versionNumber + 1}
                      </span>
                      {forecast.auditEventCount > 0 && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-800/40 border border-white/5 px-1.5 py-0.5 rounded">
                          <BookOpen className="h-2.5 w-2.5" />
                          {forecast.auditEventCount} audit event{forecast.auditEventCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-white truncate mb-1">
                      {forecast.title}
                    </h3>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      {forecast.baseYear && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {forecast.baseYear}
                          {forecast.forecastHorizonYears ? `–${forecast.baseYear + forecast.forecastHorizonYears}` : ""}
                        </span>
                      )}
                      <span>Created {formatDate(forecast.createdAt)}</span>
                      {forecast.updatedAt && forecast.updatedAt !== forecast.createdAt && (
                        <span className="flex items-center gap-1 text-slate-600">
                          Edited {formatDate(forecast.updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); setDeleteId(forecast.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Link href={`/forecast-builder/${forecast.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-white hover:bg-white/5 gap-1"
                      >
                        Open <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Forecast dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="bg-slate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">New Forecast</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-slate-300">Market or topic</Label>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. GCC corporate banking software, 2025–2030"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
                onKeyDown={e => {
                  if (e.key === "Enter" && newTitle.trim()) createMutation.mutate(newTitle.trim());
                }}
                autoFocus
              />
              <p className="text-xs text-slate-500">
                Describe the market in natural language — you'll define the boundary in detail next.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-slate-300 hover:text-white" onClick={() => setNewDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newTitle.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(newTitle.trim())}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Forecast
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this forecast?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This will permanently delete the forecast and all its data including debate history,
              assumptions, and audit trail. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-white/10 text-white hover:bg-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-500 text-white border-0"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
