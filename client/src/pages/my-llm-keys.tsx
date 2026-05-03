import { Link } from "wouter";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Key, Trash2, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

const PROVIDERS = [
  { id: "openai",     label: "OpenAI",     hint: "sk-...",       url: "https://platform.openai.com/api-keys" },
  { id: "anthropic",  label: "Anthropic",  hint: "sk-ant-...",   url: "https://console.anthropic.com/settings/keys" },
  { id: "perplexity", label: "Perplexity", hint: "pplx-...",     url: "https://www.perplexity.ai/settings/api" },
] as const;

type KeyState = Record<string, { hasKey: boolean; preview: string | null; updatedAt: string | null }>;

export default function MyLlmKeysPage() {
  const { toast } = useToast();
  const { data: keys = {} as KeyState, isLoading } = useQuery<KeyState>({
    queryKey: ["/api/me/llm-keys"],
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/me/market-builder">
          <a className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ChevronLeft className="h-4 w-4" />Back to Market Builder
          </a>
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <Key className="h-6 w-6 text-blue-600" /> LLM API Keys
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Add your own provider API keys to run the Market Builder. Keys are stored
        securely and only used for your own jobs — they're never shared.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map(p => (
            <ProviderCard
              key={p.id}
              providerId={p.id}
              label={p.label}
              hint={p.hint}
              docsUrl={p.url}
              state={keys[p.id]}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["/api/me/llm-keys"] })}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  providerId, label, hint, docsUrl, state, onChanged, toast,
}: {
  providerId: string;
  label: string;
  hint: string;
  docsUrl: string;
  state?: { hasKey: boolean; preview: string | null; updatedAt: string | null };
  onChanged: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [editing, setEditing] = useState(false);
  const [newKey, setNewKey] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/api/me/llm-keys/${providerId}`, "PUT", { apiKey: newKey.trim() }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: `${label} key saved` });
      setNewKey(""); setEditing(false);
      onChanged();
    },
    onError: (err: any) => toast({ title: "Couldn't save key", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/me/llm-keys/${providerId}`, "DELETE"),
    onSuccess: () => { toast({ title: `${label} key removed` }); onChanged(); },
  });

  const hasKey = state?.hasKey ?? false;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="font-semibold text-gray-900">{label}</p>
          <a href={docsUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
            Get an API key <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {hasKey && !editing && (
          <span className="text-xs flex items-center gap-1 text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      {editing || !hasKey ? (
        <div className="space-y-2">
          <Label className="text-xs">API key</Label>
          <Input
            type="password"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder={hint}
            className="h-9 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!newKey.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            {editing && (
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setNewKey(""); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-1">
          <code className="text-xs text-gray-600 font-mono">{state?.preview ?? "••••"}</code>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Replace</Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
