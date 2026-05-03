/**
 * Per-stage LLM model selector shown inside the Market Builder wizard.
 *
 * Two dropdowns per stage:
 *   - Scoring call LLM
 *   - Commentary call LLM
 *
 * Empty selection ⇒ falls back to the job's default provider/model.
 * Saves on every change via PUT /jobs/:id/llm-selections.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cpu } from "lucide-react";
import { PROVIDERS, MODELS } from "./market-builder-llm-panel";

type StageKind = "vendor_evaluation" | "product_evaluation" | "ecosystem_evaluation";
type PromptType = "scoring" | "commentary";

interface LlmSelection {
  id: string;
  jobId: string;
  stage: StageKind;
  promptType: PromptType;
  provider: string;
  model: string;
}

const JOB_DEFAULT = "__job_default__";

interface Props {
  jobId: string;
  stageKind: StageKind;
  // Job-level fallback shown in the UI as the default option label
  defaultProvider: string;
  defaultModel: string;
  // API base — defaults to admin so existing admin-only callers continue to work
  apiBase?: string;
}

export function LlmSelectorPanel({ jobId, stageKind, defaultProvider, defaultModel, apiBase = "/api/admin/market-builder" }: Props) {
  const { toast } = useToast();

  const { data: selections = [] } = useQuery<LlmSelection[]>({
    queryKey: [apiBase, "jobs", jobId, "llm-selections"],
    queryFn: async () => {
      const r = await fetch(`${apiBase}/jobs/${jobId}/llm-selections`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load LLM selections");
      return r.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: (item: { stage: StageKind; promptType: PromptType; provider: string | null; model: string | null }) =>
      apiRequest(`${apiBase}/jobs/${jobId}/llm-selections`, "PUT", { selections: [item] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [apiBase, "jobs", jobId, "llm-selections"] }),
    onError: (err: any) => toast({ title: "Couldn't save LLM selection", description: err.message, variant: "destructive" }),
  });

  function getCurrent(promptType: PromptType): { provider: string; model: string } | null {
    const sel = selections.find(s => s.stage === stageKind && s.promptType === promptType);
    return sel ? { provider: sel.provider, model: sel.model } : null;
  }

  function selectValue(promptType: PromptType): string {
    const cur = getCurrent(promptType);
    return cur ? `${cur.provider}::${cur.model}` : JOB_DEFAULT;
  }

  function onChange(promptType: PromptType, value: string) {
    if (value === JOB_DEFAULT) {
      saveMut.mutate({ stage: stageKind, promptType, provider: null, model: null });
      return;
    }
    const [provider, model] = value.split("::");
    saveMut.mutate({ stage: stageKind, promptType, provider, model });
  }

  const overrideCount = selections.filter(s => s.stage === stageKind).length;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/30 px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <Cpu className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-semibold text-blue-900">LLM Models for this Stage</span>
        {overrideCount > 0 && (
          <span className="text-xs bg-blue-600 text-white rounded-full px-2 py-0.5">
            {overrideCount} override{overrideCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="text-xs text-blue-700/80">— defaults to {defaultProvider}/{defaultModel}.</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LlmRow
          label="Scoring call"
          value={selectValue("scoring")}
          onValueChange={v => onChange("scoring", v)}
          defaultLabel={`Job default (${defaultProvider} / ${defaultModel})`}
        />
        <LlmRow
          label="Commentary call"
          value={selectValue("commentary")}
          onValueChange={v => onChange("commentary", v)}
          defaultLabel={`Job default (${defaultProvider} / ${defaultModel})`}
        />
      </div>
    </div>
  );
}

function LlmRow({ label, value, onValueChange, defaultLabel }: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  defaultLabel: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={JOB_DEFAULT}>{defaultLabel}</SelectItem>
          {PROVIDERS.map(p => (
            <SelectGroup key={p.id} providerId={p.id} providerLabel={p.label} />
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SelectGroup({ providerId, providerLabel }: { providerId: string; providerLabel: string }) {
  const models = MODELS[providerId] ?? [];
  return (
    <>
      <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{providerLabel}</div>
      {models.map(m => (
        <SelectItem key={`${providerId}::${m.id}`} value={`${providerId}::${m.id}`}>
          {m.label}
        </SelectItem>
      ))}
    </>
  );
}
