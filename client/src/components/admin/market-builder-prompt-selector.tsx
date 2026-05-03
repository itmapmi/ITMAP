/**
 * Per-stage prompt selector shown inside the Market Builder wizard.
 *
 * Stage 2 (vendor_evaluation): one row per criterion (8 dropdowns × 2 prompt types)
 * Stage 4 (product_evaluation): one row per category, each expandable to show
 *   per-feature override rows (feature override beats category override)
 * Stage 6 (ecosystem_evaluation): same as stage 4
 *
 * Saves on every dropdown change via PUT /jobs/:id/prompt-selections.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Sparkles, Lock } from "lucide-react";

type StageKind = "vendor_evaluation" | "product_evaluation" | "ecosystem_evaluation";
type PromptType = "scoring" | "commentary";
type TargetType = "criterion" | "category" | "feature";

interface Prompt {
  id: string;
  name: string;
  promptType: PromptType;
  stage: StageKind;
  isSystem: boolean;
}

interface Selection {
  id: string;
  jobId: string;
  stage: StageKind;
  targetType: string;
  targetKey: string;
  promptType: PromptType;
  promptId: string | null;
}

const SYSTEM_DEFAULT_VALUE = "__system_default__";

interface Props {
  jobId: string;
  stageKind: StageKind;
  // For stage 2: pass criteria[]; for 4 & 6: pass categories with features
  criteria?: Array<{ id: string; name: string; category: string }>;
  categories?: Array<{ name: string; features: Array<{ name: string }> }>;
}

export function PromptSelector({ jobId, stageKind, criteria, categories }: Props) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const { data: prompts = [] } = useQuery<Prompt[]>({
    queryKey: ["/api/admin/prompts", { stage: stageKind }],
    queryFn: async () => {
      const r = await fetch(`/api/admin/prompts?stage=${stageKind}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load prompts");
      return r.json();
    },
  });

  const { data: selections = [] } = useQuery<Selection[]>({
    queryKey: ["/api/admin/market-builder/jobs", jobId, "prompt-selections"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/market-builder/jobs/${jobId}/prompt-selections`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load selections");
      return r.json();
    },
  });

  const scoringPrompts = useMemo(() => prompts.filter(p => p.promptType === "scoring"), [prompts]);
  const commentaryPrompts = useMemo(() => prompts.filter(p => p.promptType === "commentary"), [prompts]);

  const saveMut = useMutation({
    mutationFn: async (selectionsToSave: Array<{
      stage: StageKind; targetType: TargetType; targetKey: string; promptType: PromptType; promptId: string | null;
    }>) => {
      return apiRequest("PUT", `/api/admin/market-builder/jobs/${jobId}/prompt-selections`, { selections: selectionsToSave });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-builder/jobs", jobId, "prompt-selections"] });
    },
    onError: (err: any) => toast({ title: "Couldn't save prompt selection", description: err.message, variant: "destructive" }),
  });

  function getCurrent(targetType: TargetType, targetKey: string, promptType: PromptType): string {
    const sel = selections.find(s =>
      s.stage === stageKind && s.targetType === targetType
      && s.targetKey === targetKey && s.promptType === promptType
    );
    return sel?.promptId ?? SYSTEM_DEFAULT_VALUE;
  }

  function setSelection(targetType: TargetType, targetKey: string, promptType: PromptType, value: string) {
    const promptId = value === SYSTEM_DEFAULT_VALUE ? null : value;
    saveMut.mutate([{ stage: stageKind, targetType, targetKey, promptType, promptId }]);
  }

  // Count active overrides for the badge
  const overrideCount = selections.filter(s => s.stage === stageKind && s.promptId).length;

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/30">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-purple-50/50 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-600" />
          <span className="text-sm font-semibold text-purple-900">Customize Prompts</span>
          {overrideCount > 0 && (
            <span className="text-xs bg-purple-600 text-white rounded-full px-2 py-0.5">{overrideCount} override{overrideCount === 1 ? "" : "s"}</span>
          )}
          <span className="text-xs text-purple-700/80">— each row uses the system default unless you choose a custom prompt.</span>
        </div>
        {collapsed ? <ChevronRight className="h-4 w-4 text-purple-700" /> : <ChevronDown className="h-4 w-4 text-purple-700" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {prompts.length === 0 && (
            <p className="text-xs text-gray-600 italic">No prompts loaded yet.</p>
          )}

          {/* Stage 2: per-criterion */}
          {stageKind === "vendor_evaluation" && criteria && (
            <div className="space-y-2">
              <HeaderRow />
              {criteria.map(c => (
                <SelectorRow
                  key={c.id}
                  label={c.name}
                  sublabel={c.category}
                  scoringValue={getCurrent("criterion", c.name, "scoring")}
                  commentaryValue={getCurrent("criterion", c.name, "commentary")}
                  scoringPrompts={scoringPrompts}
                  commentaryPrompts={commentaryPrompts}
                  onScoringChange={v => setSelection("criterion", c.name, "scoring", v)}
                  onCommentaryChange={v => setSelection("criterion", c.name, "commentary", v)}
                />
              ))}
            </div>
          )}

          {/* Stages 4 & 6: per-category with expandable per-feature overrides */}
          {(stageKind === "product_evaluation" || stageKind === "ecosystem_evaluation") && categories && (
            <div className="space-y-2">
              <HeaderRow />
              {categories.length === 0 && (
                <p className="text-xs text-gray-500 italic">Run the previous stage first to define {stageKind === "product_evaluation" ? "product features" : "ecosystem integrations"}.</p>
              )}
              {categories.map(cat => {
                const isExpanded = expandedCategory === cat.name;
                return (
                  <div key={cat.name} className="bg-white rounded border border-gray-200">
                    <SelectorRow
                      label={cat.name}
                      sublabel={`${cat.features.length} feature${cat.features.length === 1 ? "" : "s"}`}
                      scoringValue={getCurrent("category", cat.name, "scoring")}
                      commentaryValue={getCurrent("category", cat.name, "commentary")}
                      scoringPrompts={scoringPrompts}
                      commentaryPrompts={commentaryPrompts}
                      onScoringChange={v => setSelection("category", cat.name, "scoring", v)}
                      onCommentaryChange={v => setSelection("category", cat.name, "commentary", v)}
                      trailing={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 shrink-0"
                          onClick={() => setExpandedCategory(isExpanded ? null : cat.name)}
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          Features
                        </Button>
                      }
                    />
                    {isExpanded && (
                      <div className="border-t border-gray-100 bg-gray-50/50 px-2 py-2 space-y-1.5">
                        <p className="text-[11px] text-gray-500 px-2 italic">
                          Per-feature override beats the category-level selection above.
                        </p>
                        {cat.features.map(f => (
                          <SelectorRow
                            key={f.name}
                            indent
                            label={f.name}
                            scoringValue={getCurrent("feature", f.name, "scoring")}
                            commentaryValue={getCurrent("feature", f.name, "commentary")}
                            scoringPrompts={scoringPrompts}
                            commentaryPrompts={commentaryPrompts}
                            onScoringChange={v => setSelection("feature", f.name, "scoring", v)}
                            onCommentaryChange={v => setSelection("feature", f.name, "commentary", v)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="grid grid-cols-[1fr_220px_220px_auto] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      <div>Target</div>
      <div>Scoring Prompt</div>
      <div>Commentary Prompt</div>
      <div></div>
    </div>
  );
}

function SelectorRow({
  label, sublabel, indent,
  scoringValue, commentaryValue,
  scoringPrompts, commentaryPrompts,
  onScoringChange, onCommentaryChange,
  trailing,
}: {
  label: string;
  sublabel?: string;
  indent?: boolean;
  scoringValue: string;
  commentaryValue: string;
  scoringPrompts: Prompt[];
  commentaryPrompts: Prompt[];
  onScoringChange: (v: string) => void;
  onCommentaryChange: (v: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={`grid grid-cols-[1fr_220px_220px_auto] gap-2 items-center px-2 py-1.5 ${indent ? "pl-6" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
        {sublabel && <p className="text-[11px] text-gray-500 capitalize truncate">{sublabel}</p>}
      </div>
      <Select value={scoringValue} onValueChange={onScoringChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM_DEFAULT_VALUE}>
            <span className="flex items-center gap-1.5"><Lock className="h-3 w-3 text-gray-400" />System Default</span>
          </SelectItem>
          {scoringPrompts.filter(p => !p.isSystem).map(p => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={commentaryValue} onValueChange={onCommentaryChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM_DEFAULT_VALUE}>
            <span className="flex items-center gap-1.5"><Lock className="h-3 w-3 text-gray-400" />System Default</span>
          </SelectItem>
          {commentaryPrompts.filter(p => !p.isSystem).map(p => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div>{trailing}</div>
    </div>
  );
}
