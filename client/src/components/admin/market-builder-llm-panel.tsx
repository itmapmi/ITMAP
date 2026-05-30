import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Settings, Key, CheckCircle2, Trash2, Loader2 } from "lucide-react";

const PROVIDERS = [
  { id: "openai",     label: "OpenAI" },
  { id: "anthropic",  label: "Anthropic (Claude)" },
  { id: "perplexity", label: "Perplexity" },
];

const MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4.1",       label: "GPT-4.1 (Latest)" },
    { id: "gpt-4.1-mini",  label: "GPT-4.1 Mini (Fast)" },
    { id: "gpt-4.1-nano",  label: "GPT-4.1 Nano (Fastest)" },
    { id: "gpt-4o",        label: "GPT-4o" },
    { id: "gpt-4o-mini",   label: "GPT-4o Mini" },
    { id: "o3",            label: "o3 (Reasoning)" },
    { id: "o3-mini",       label: "o3-mini" },
    { id: "o4-mini",       label: "o4-mini" },
  ],
  anthropic: [
    { id: "claude-opus-4-8",            label: "Claude Opus 4.8 (Most Capable)" },
    { id: "claude-opus-4-7",            label: "Claude Opus 4.7" },
    { id: "claude-opus-4-6",            label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6 (Recommended)" },
    { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5 (Fastest)" },
  ],
  perplexity: [
    { id: "sonar-pro",           label: "Sonar Pro (Web Search)" },
    { id: "sonar",               label: "Sonar (Web Search)" },
    { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
    { id: "sonar-reasoning",     label: "Sonar Reasoning" },
    { id: "sonar-deep-research", label: "Sonar Deep Research" },
  ],
};

interface KeyStatus { provider: string; hasKey: boolean; keyPreview: string | null }

interface LLMSelectorProps {
  provider: string;
  model: string;
  onProviderChange: (p: string) => void;
  onModelChange: (m: string) => void;
  disabled?: boolean;
  mode?: "admin" | "user";
}

export function LLMSelector({ provider, model, onProviderChange, onModelChange, disabled, mode = "admin" }: LLMSelectorProps) {
  const models = MODELS[provider] ?? [];
  return (
    <div className="flex items-center gap-2">
      <Select value={provider} onValueChange={v => { onProviderChange(v); onModelChange(MODELS[v]?.[0]?.id ?? ""); }} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={model} onValueChange={onModelChange} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <LLMSettingsButton mode={mode} />
    </div>
  );
}

function LLMSettingsButton({ mode = "admin" }: { mode?: "admin" | "user" }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const isUser = mode === "user";
  const queryKey = isUser ? ["/api/me/llm-keys"] : ["/api/admin/market-builder/settings/llm"];

  const { data: rawData } = useQuery<any>({
    queryKey,
    enabled: open,
  });

  // Normalise both response shapes into { provider, hasKey, keyPreview }[]
  const keyStatuses: KeyStatus[] = isUser
    ? PROVIDERS.map(p => ({
        provider: p.id,
        hasKey: rawData?.[p.id]?.hasKey ?? false,
        keyPreview: rawData?.[p.id]?.preview ?? null,
      }))
    : (rawData ?? []) as KeyStatus[];

  const saveKey = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      isUser
        ? apiRequest(`/api/me/llm-keys/${provider}`, "PUT", { apiKey }).then(r => r.json())
        : apiRequest(`/api/admin/market-builder/settings/llm/${provider}`, "PUT", { apiKey }).then(r => r.json()),
    onSuccess: (_, { provider }) => {
      queryClient.invalidateQueries({ queryKey });
      setInputs(prev => ({ ...prev, [provider]: "" }));
      toast({ title: `${provider} API key saved` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeKey = useMutation({
    mutationFn: (provider: string) =>
      isUser
        ? apiRequest(`/api/me/llm-keys/${provider}`, "DELETE")
        : apiRequest(`/api/admin/market-builder/settings/llm/${provider}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const statusFor = (pid: string) => keyStatuses.find(k => k.provider === pid);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Manage API keys">
          <Settings className="h-4 w-4 text-gray-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> LLM API Keys
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-500 -mt-2">
          Keys are stored securely and only shown in preview form. OpenAI without a key uses the built-in Replit integration.
        </p>
        <div className="space-y-4 pt-1">
          {PROVIDERS.map(p => {
            const status = statusFor(p.id);
            return (
              <div key={p.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">{p.label}</Label>
                  {status?.hasKey && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-xs text-gray-500 font-mono">{status.keyPreview}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeKey.mutate(p.id)}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={status?.hasKey ? "Replace existing key…" : `Paste ${p.label} API key…`}
                    value={inputs[p.id] ?? ""}
                    onChange={e => setInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={!inputs[p.id]?.trim() || saveKey.isPending}
                    onClick={() => saveKey.mutate({ provider: p.id, apiKey: inputs[p.id].trim() })}
                  >
                    {saveKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { PROVIDERS, MODELS };
