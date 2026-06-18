import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, Lock, Key, Eye, EyeOff, CheckCircle2, Trash2, ExternalLink, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const TABS = ["Security", "API Keys"] as const;
type Tab = (typeof TABS)[number];

const PROVIDERS = [
  { id: "openai",     label: "OpenAI",     hint: "sk-...",     url: "https://platform.openai.com/api-keys" },
  { id: "anthropic",  label: "Anthropic",  hint: "sk-ant-...", url: "https://console.anthropic.com/settings/keys" },
  { id: "perplexity", label: "Perplexity", hint: "pplx-...",   url: "https://www.perplexity.ai/settings/api" },
] as const;

type KeyState = Record<string, { hasKey: boolean; preview: string | null; updatedAt: string | null }>;

export default function MySettings() {
  const [tab, setTab] = useState<Tab>("Security");

  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        <Link href="/me/profile">
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 cursor-pointer mb-8">
            <ChevronLeft className="h-4 w-4" /> Back to Profile
          </span>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your security and integrations.</p>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-900 border border-white/5 rounded-xl mb-8 w-fit">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === t
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Security" && <SecurityTab />}
        {tab === "API Keys" && <ApiKeysTab />}

      </div>
    </div>
  );
}

function SecurityTab() {
  const { toast } = useToast();
  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext]       = useState(false);

  const change = useMutation({
    mutationFn: () =>
      apiRequest("/api/me/password", "PATCH", { currentPassword: current, newPassword: next }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Password updated" });
      setCurrent(""); setNext(""); setConfirm("");
    },
    onError: (err: any) =>
      toast({ title: "Failed to update password", description: err.message, variant: "destructive" }),
  });

  const valid = current.length >= 1 && next.length >= 8 && next === confirm;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-slate-900 border border-white/5 rounded-2xl p-8"
    >
      <div className="flex items-center gap-2 mb-6">
        <Lock className="h-5 w-5 text-violet-400" />
        <h2 className="text-lg font-semibold text-white">Change Password</h2>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label className="text-slate-400 text-sm">Current Password</Label>
          <div className="relative">
            <Input
              type={showCurrent ? "text" : "password"}
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Enter current password"
              className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl pr-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-400 text-sm">New Password</Label>
          <div className="relative">
            <Input
              type={showNext ? "text" : "password"}
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="At least 8 characters"
              className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNext(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-400 text-sm">Confirm New Password</Label>
          <Input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat new password"
            className={`bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl ${
              confirm && next !== confirm ? "border-red-500/50" : ""
            }`}
          />
          {confirm && next !== confirm && (
            <p className="text-red-400 text-xs">Passwords don't match</p>
          )}
        </div>

        <Button
          onClick={() => change.mutate()}
          disabled={!valid || change.isPending}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          <Save className="h-4 w-4 mr-2" />
          {change.isPending ? "Updating…" : "Update Password"}
        </Button>
      </div>
    </motion.div>
  );
}

function ApiKeysTab() {
  const { toast } = useToast();
  const { data: keys = {} as KeyState, isLoading } = useQuery<KeyState>({
    queryKey: ["/api/me/llm-keys"],
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Key className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-semibold text-white">LLM API Keys</h2>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Add your own provider API keys to run the Market Builder. Keys are stored securely and never shared.
      </p>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
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
    </motion.div>
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
  const [newKey, setNewKey]   = useState("");
  const hasKey = state?.hasKey ?? false;

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/api/me/llm-keys/${providerId}`, "PUT", { apiKey: newKey.trim() }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: `${label} key saved` });
      setNewKey(""); setEditing(false);
      onChanged();
    },
    onError: (err: any) =>
      toast({ title: "Couldn't save key", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/me/llm-keys/${providerId}`, "DELETE"),
    onSuccess: () => { toast({ title: `${label} key removed` }); onChanged(); },
  });

  const test = useMutation({
    mutationFn: () =>
      apiRequest(`/api/me/llm-keys/${providerId}/test`, "POST", newKey.trim() ? { apiKey: newKey.trim() } : {}).then(r => r.json()),
    onSuccess: () => toast({ title: `${label} connection successful` }),
    onError: (err: any) =>
      toast({ title: `${label} test failed`, description: err.message, variant: "destructive" }),
  });

  return (
    <div className="bg-slate-900 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-white">{label}</p>
          <a href={docsUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 mt-0.5">
            Get an API key <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {hasKey && !editing && (
          <span className="text-xs flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      {editing || !hasKey ? (
        <div className="space-y-3">
          <Input
            type="password"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder={hint}
            className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!newKey.trim() || save.isPending} onClick={() => save.mutate()}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" disabled={!newKey.trim() || test.isPending}
              onClick={() => test.mutate()}
              className="border-white/10 text-slate-300 hover:text-white bg-transparent">
              {test.isPending ? "Testing…" : "Test"}
            </Button>
            {editing && (
              <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white"
                onClick={() => { setEditing(false); setNewKey(""); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <code className="text-xs text-slate-400 font-mono">{state?.preview ?? "••••"}</code>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}
              className="border-white/10 text-slate-300 hover:text-white bg-transparent">
              {test.isPending ? "Testing…" : "Test"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}
              className="border-white/10 text-slate-300 hover:text-white bg-transparent">
              Replace
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}
              className="text-slate-400 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
