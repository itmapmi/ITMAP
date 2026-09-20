import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, TrendingUp, Plus, Eye, EyeOff, Sprout, Building2 } from "lucide-react";
import { insertMarketSchema, type InsertMarket, type Market, type Criteria } from "@shared/schema";
import { SimpleImageUploader } from "@/components/SimpleImageUploader";
import {
  DEFAULT_QUADRANT_THRESHOLDS,
  EMERGING_WEIGHT_OVERRIDES,
  getDefaultCriterionWeight,
  validateThresholds,
  type PublishedChartConfig,
  type PublishedChartWeightVersion,
  type QuadrantThresholds,
} from "@shared/quadrant-positioning";

type WeightVersionRow = PublishedChartWeightVersion & {
  weights: Array<{ criteriaId: string; name: string; weight: number }>;
  thresholds: QuadrantThresholds;
};

/** Threshold inputs are edited as text so a half-typed "4." is not clobbered. */
type ThresholdDraft = { executionLow: string; executionHigh: string; viability: string };

function draftFromThresholds(t: QuadrantThresholds): ThresholdDraft {
  return { executionLow: String(t.executionLow), executionHigh: String(t.executionHigh), viability: String(t.viability) };
}

function thresholdsFromDraft(d: ThresholdDraft): QuadrantThresholds {
  return { executionLow: Number(d.executionLow), executionHigh: Number(d.executionHigh), viability: Number(d.viability) };
}

/** e.g. "Business Model, Revenue and Partner Ecosystem default to 10%" — from the shared defaults. */
const EMERGING_DEFAULTS_COPY = (() => {
  const names = Object.keys(EMERGING_WEIGHT_OVERRIDES);
  const values = Array.from(new Set(Object.values(EMERGING_WEIGHT_OVERRIDES)));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  return values.length === 1
    ? `${list} default to ${values[0]}%`
    : names.map(n => `${n} ${EMERGING_WEIGHT_OVERRIDES[n]}%`).join(", ");
})();

function formatVersionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function MarketManagement() {
  const { toast } = useToast();
  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/admin/markets"],
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  // Published chart configuration (effective weights + thresholds) for the
  // market being edited, and its admin-only weight version history.
  const { data: chartConfig, isFetched: chartConfigFetched } = useQuery<PublishedChartConfig>({
    queryKey: ["/api/markets", editingMarket?.id, "chart-config"],
    enabled: !!editingMarket,
  });
  const { data: weightVersions } = useQuery<WeightVersionRow[]>({
    queryKey: ["/api/admin/markets", editingMarket?.id, "weight-versions"],
    enabled: !!editingMarket,
  });

  // Local weight state keyed by criteria id (0–100) and the three box
  // thresholds (rubric units, 0–10) that decide Custodians / Contenders /
  // Leaders and the top / bottom row.
  const [criteriaWeights, setCriteriaWeights] = useState<{ [criteriaId: string]: number }>({});
  const [thresholdDraft, setThresholdDraft] = useState<ThresholdDraft>(draftFromThresholds(DEFAULT_QUADRANT_THRESHOLDS));
  const [changeNote, setChangeNote] = useState("");
  const thresholdProblem = validateThresholds(thresholdsFromDraft(thresholdDraft));

  const form = useForm<InsertMarket>({
    resolver: zodResolver(insertMarketSchema),
    defaultValues: {
      name: "",
      description: "",
      shortDescription: "",
      category: "",
      imageUrl: "",
      isVisible: true,
      isInReview: false,
      marketType: "mature",
    },
  });

  const watchedMarketType = form.watch("marketType");

  // Seed weights + thresholds exactly once per dialog session: from the
  // published configuration when editing (once it has loaded), from the
  // marketType defaults when creating. Keyed by session so a background
  // refetch of the config never clobbers edits in progress.
  const dialogSession = editingMarket ? `edit:${editingMarket.id}` : showCreateDialog ? "create" : null;
  const seededSessionRef = useRef<string | null>(null);
  const seededMarketTypeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!dialogSession) { seededSessionRef.current = null; return; }
    if (!criteria || seededSessionRef.current === dialogSession) return;
    // In edit mode, wait for the config to load before seeding — otherwise
    // defaults could briefly populate and overwrite saved values on a fast submit.
    if (editingMarket && !chartConfigFetched) return;
    const next: { [id: string]: number } = {};
    criteria.forEach(c => {
      const published = editingMarket ? chartConfig?.weightsById[c.id] : undefined;
      next[c.id] = published ?? getDefaultCriterionWeight(c.name, watchedMarketType);
    });
    setCriteriaWeights(next);
    setThresholdDraft(draftFromThresholds(editingMarket && chartConfig ? chartConfig.thresholds : DEFAULT_QUADRANT_THRESHOLDS));
    setChangeNote("");
    seededSessionRef.current = dialogSession;
    seededMarketTypeRef.current = watchedMarketType;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, chartConfig, chartConfigFetched, editingMarket, dialogSession, watchedMarketType]);

  // Switching the market type after seeding is an explicit choice: reset the
  // weights to that type's defaults (the server applies the same defaults when
  // the type change is saved, so the follow-up chart-config save is a no-op
  // unless the admin adjusts them further). Thresholds and the note are kept.
  useEffect(() => {
    if (!criteria || !dialogSession || seededSessionRef.current !== dialogSession) return;
    if (seededMarketTypeRef.current === watchedMarketType) return;
    seededMarketTypeRef.current = watchedMarketType;
    const next: { [id: string]: number } = {};
    criteria.forEach(c => { next[c.id] = getDefaultCriterionWeight(c.name, watchedMarketType); });
    setCriteriaWeights(next);
  }, [criteria, dialogSession, watchedMarketType]);

  // Save the chart configuration after the market itself is persisted. The
  // server records a new weight version only when the effective weights or
  // thresholds actually changed. Failures must not fail the whole mutation
  // (the market is already saved) — surface a warning instead.
  const saveChartConfig = async (marketId: string) => {
    if (!criteria) return;
    try {
      const weights: Record<string, number> = {};
      criteria.forEach(c => { weights[c.id] = criteriaWeights[c.id] ?? 100; });
      await apiRequest(`/api/markets/${marketId}/chart-config`, "PUT", {
        weights,
        thresholds: thresholdsFromDraft(thresholdDraft),
        note: changeNote.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "chart-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "chart-provenance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets", marketId, "weight-versions"] });
    } catch (err) {
      console.error("Failed to save chart configuration:", err);
      toast({
        title: "Chart configuration not saved",
        description: err instanceof Error && err.message
          ? err.message
          : "The market was saved, but its criteria weights / thresholds failed to save. Re-open the market and update them again.",
        variant: "destructive",
      });
    }
  };

  const createMarketMutation = useMutation({
    mutationFn: async (data: InsertMarket) => {
      const response = await apiRequest("/api/markets", "POST", data);
      const created = await response.json();
      // Persist the chosen criteria weights + thresholds for the new market.
      if (created?.id) await saveChartConfig(created.id);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      form.reset();
      setShowCreateDialog(false);
      toast({
        title: "Success",
        description: "Market created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create market",
        variant: "destructive",
      });
    },
  });

  const updateMarketMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertMarket }) => {
      const response = await apiRequest(`/api/markets/${id}`, "PUT", data);
      const updated = await response.json();
      // Persist any weight / threshold changes made in the edit dialog.
      await saveChartConfig(id);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setEditingMarket(null);
      setShowEditDialog(false);
      form.reset();
      toast({
        title: "Success",
        description: "Market updated successfully",
      });
    },
    onError: (error: Error) => {
      console.error("Market update error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update market",
        variant: "destructive",
      });
    },
  });

  const deleteMarketMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/markets/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      toast({
        title: "Success",
        description: "Market deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete market",
        variant: "destructive",
      });
    },
  });

  const updateMarketImageMutation = useMutation({
    mutationFn: async ({ marketId, imageURL }: { marketId: string; imageURL: string }) => {
      const response = await apiRequest(`/api/markets/${marketId}/image`, "PUT", { imageURL });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      toast({
        title: "Success",
        description: "Market image updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update market image",
        variant: "destructive",
      });
    },
  });

  const handleImageChange = (url: string) => {
    form.setValue("imageUrl", url);
    
    // If editing a market, also update in the backend
    if (editingMarket && url) {
      updateMarketImageMutation.mutate({ 
        marketId: editingMarket.id, 
        imageURL: url 
      });
    }
  };

  const onSubmit = (data: InsertMarket) => {
    if (thresholdProblem) {
      toast({ title: "Check the quadrant thresholds", description: thresholdProblem, variant: "destructive" });
      return;
    }
    if (editingMarket) {
      updateMarketMutation.mutate({ id: editingMarket.id, data });
    } else {
      createMarketMutation.mutate(data);
    }
  };

  const handleEdit = (market: Market) => {
    setEditingMarket(market);
    setShowEditDialog(true);
    form.reset({
      name: market.name,
      description: market.description || "",
      shortDescription: market.shortDescription || "",
      category: market.category || "",
      imageUrl: market.imageUrl || "",
      isVisible: market.isVisible !== false,
      isInReview: (market as any).isInReview === true,
      marketType: (market as any).marketType || "mature",
    });
  };

  const handleCancelEdit = () => {
    setEditingMarket(null);
    setShowEditDialog(false);
    form.reset({
      name: "",
      description: "",
      shortDescription: "",
      category: "",
      imageUrl: "",
      isVisible: true,
      isInReview: false,
      marketType: "mature",
    });
  };

  const handleCancelCreate = () => {
    setShowCreateDialog(false);
    form.reset({
      name: "",
      description: "",
      shortDescription: "",
      category: "",
      imageUrl: "",
      isVisible: true,
      isInReview: false,
      marketType: "mature",
    });
  };

  // Reusable form body. A plain render function (not an inline component):
  // an inline component gets a new identity on every parent re-render, which
  // would remount the form and drop focus while typing in the inputs below.
  const renderMarketForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Market Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Cloud Infrastructure" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="shortDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Short Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Brief description for market thumbnails..."
                  rows={2}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Detailed market description..."
                  rows={4}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Infrastructure">Infrastructure</SelectItem>
                  <SelectItem value="Data, Analytics & AI">Data, Analytics & AI</SelectItem>
                  <SelectItem value="Cybersecurity">Cybersecurity</SelectItem>
                  <SelectItem value="DevOps & Platforms">DevOps & Platforms</SelectItem>
                  <SelectItem value="Business Applications">Business Applications</SelectItem>
                  <SelectItem value="Collaboration and Productivity">Collaboration and Productivity</SelectItem>
                  <SelectItem value="Industrial Applications">Industrial Applications</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="imageUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Market Thumbnail Image</FormLabel>
              <FormControl>
                <SimpleImageUploader
                  value={field.value || ""}
                  onChange={handleImageChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="marketType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Market Type</FormLabel>
              <FormControl>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => field.onChange("mature")}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                      field.value === "mature" || !field.value
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium text-sm">Mature</div>
                      <div className="text-xs text-muted-foreground">Standard default weights</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => field.onChange("emerging")}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                      field.value === "emerging"
                        ? "border-green-500 bg-green-50 text-green-900"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Sprout className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium text-sm">Emerging</div>
                      <div className="text-xs text-muted-foreground">{EMERGING_DEFAULTS_COPY}</div>
                    </div>
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Criteria Weights — drive the Magic Quadrant dot positions. */}
        {criteria && criteria.length > 0 && (
          <div className="rounded-lg border p-4 space-y-4">
            <div>
              <div className="text-base font-medium">Vendor Evaluation Criteria Weights</div>
              <div className="text-sm text-muted-foreground">
                The published chart positions every vendor from its own scores and these saved weights. Buyers can move
                sliders on the market page for a what-if view, but that never changes the published chart.
              </div>
            </div>
            {criteria.map(c => (
              <div key={c.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{c.name}</span>
                  <span className="tabular-nums text-muted-foreground w-10 text-right">{criteriaWeights[c.id] ?? 100}%</span>
                </div>
                <Slider
                  value={[criteriaWeights[c.id] ?? 100]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([v]) => setCriteriaWeights(prev => ({ ...prev, [c.id]: v }))}
                  data-testid={`slider-weight-${c.name.toLowerCase().replace(/\s+/g, '-')}`}
                />
              </div>
            ))}
          </div>
        )}

        {/* Quadrant thresholds — rubric-unit cut-offs for the six boxes. */}
        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <div className="text-base font-medium">Quadrant Thresholds</div>
            <div className="text-sm text-muted-foreground">
              Weighted composites are on the 0–10 scoring scale. A vendor enters Contenders / Leaders when its
              Execution composite reaches these values, and the top row when its Viability composite reaches the
              third. Dividers are always drawn at 33 / 67 / 50; the thresholds decide which composite lands on them.
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ["executionLow", "Contenders from (Execution)"],
              ["executionHigh", "Leaders from (Execution)"],
              ["viability", "Top row from (Viability)"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`threshold-${key}`}>{label}</label>
                <Input
                  id={`threshold-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={9.9}
                  step={0.1}
                  value={thresholdDraft[key]}
                  onChange={(e) => setThresholdDraft(prev => ({ ...prev, [key]: e.target.value }))}
                  data-testid={`input-threshold-${key}`}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className={`text-xs ${thresholdProblem ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-threshold-status">
              {thresholdProblem ?? `Defaults: ${DEFAULT_QUADRANT_THRESHOLDS.executionLow} / ${DEFAULT_QUADRANT_THRESHOLDS.executionHigh} / ${DEFAULT_QUADRANT_THRESHOLDS.viability}.`}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setThresholdDraft(draftFromThresholds(DEFAULT_QUADRANT_THRESHOLDS))}
              data-testid="button-reset-thresholds"
            >
              Reset to defaults
            </Button>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="chart-config-note">Change note (optional)</label>
            <Input
              id="chart-config-note"
              placeholder="Why the weights or thresholds changed — recorded in the version history"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              maxLength={500}
              data-testid="input-chart-config-note"
            />
          </div>
        </div>

        {/* Admin-only audit trail. Nothing version-related appears on buyer surfaces. */}
        {editingMarket && (
          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="text-base font-medium">Weight Version History</div>
              <div className="text-sm text-muted-foreground">
                Every saved change to the published weights or thresholds is recorded here. Exports cite the version they were produced from.
              </div>
            </div>
            {!weightVersions ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : weightVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions recorded yet — the first save will create v1.</p>
            ) : (
              <ol className="space-y-2 max-h-64 overflow-y-auto pr-1" data-testid="list-weight-versions">
                {weightVersions.map((v, index) => (
                  <li key={v.version} className="rounded-md border bg-muted/30 p-3 text-sm" data-testid={`row-weight-version-${v.version}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="font-medium">
                        v{v.version}{index === 0 ? " · current" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatVersionDate(v.createdAt)} · {v.createdByLabel}
                      </span>
                    </div>
                    {v.note && <p className="mt-1 text-xs text-muted-foreground">{v.note}</p>}
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      Thresholds {v.thresholds.executionLow} / {v.thresholds.executionHigh} / {v.thresholds.viability} ·{" "}
                      {v.weights.map(w => `${w.name} ${w.weight}`).join(" · ")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <FormField
          control={form.control}
          name="isVisible"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">
                  Visible in Frontend
                </FormLabel>
                <div className="text-sm text-muted-foreground">
                  Toggle to show or hide this market from public view
                </div>
              </div>
              <FormControl>
                <Switch
                  checked={field.value !== false}
                  onCheckedChange={field.onChange}
                  data-testid="toggle-market-visibility"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isInReview"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-amber-50/50 border-amber-200">
              <div className="space-y-0.5">
                <FormLabel className="text-base text-amber-800">
                  In Review
                </FormLabel>
                <div className="text-sm text-amber-700/70">
                  When enabled, market cards show an "In Review" badge instead of "Live Data". Use while research is still being finalised.
                </div>
              </div>
              <FormControl>
                <Switch
                  checked={field.value === true}
                  onCheckedChange={field.onChange}
                  data-testid="toggle-market-in-review"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex space-x-2">
          <Button 
            type="submit" 
            className="flex-1"
            disabled={createMarketMutation.isPending || updateMarketMutation.isPending}
          >
            {editingMarket ? "Update Market" : "Add Market"}
          </Button>
          <Button 
            type="button" 
            variant="outline" 
            onClick={editingMarket ? handleCancelEdit : handleCancelCreate}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );

  return (
    <div className="space-y-6">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Market Management</h2>
          <p className="text-gray-600">Create and manage technology markets</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Market
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create New Market</DialogTitle>
            </DialogHeader>
            {renderMarketForm()}
          </DialogContent>
        </Dialog>
      </div>

      {/* Markets List */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Markets</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-gray-100 p-4 rounded-lg animate-pulse">
                  <div className="h-5 bg-gray-200 rounded mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : !markets || markets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <TrendingUp className="mx-auto h-12 w-12 mb-4 text-gray-300" />
              <p>No markets created yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first market to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {markets.map(market => (
                <div key={market.id} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center space-x-4">
                    {market.imageUrl && (
                      <img 
                        src={market.imageUrl} 
                        alt={market.name}
                        className="w-16 h-10 object-cover rounded border"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h5 className="font-medium text-gray-900">{market.name}</h5>
                        {market.isVisible === false ? (
                          <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"
                            data-testid={`badge-hidden-${market.id}`}
                          >
                            <EyeOff className="h-3 w-3" />
                            Hidden
                          </span>
                        ) : (
                          <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                            data-testid={`badge-visible-${market.id}`}
                          >
                            <Eye className="h-3 w-3" />
                            Visible
                          </span>
                        )}
                        {(market as any).isInReview === true && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                            In Review
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {market.category} • Updated {market.updatedAt ? 
                          new Date(market.updatedAt).toLocaleDateString() : 
                          'recently'
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleEdit(market)}
                      data-testid={`button-edit-${market.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => deleteMarketMutation.mutate(market.id)}
                      disabled={deleteMarketMutation.isPending}
                      data-testid={`button-delete-${market.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Market: {editingMarket?.name}</DialogTitle>
          </DialogHeader>
          {renderMarketForm()}
        </DialogContent>
      </Dialog>
    </div>
  );
}