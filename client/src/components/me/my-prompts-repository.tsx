/**
 * End-user prompt repository UI.
 *
 * Same shape as the admin PromptsAdmin component, but uses /api/me/prompts so
 * users see their own private prompts plus the read-only system defaults.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Lock, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PromptRepository } from "@shared/schema";

const STAGES = [
  { value: "vendor_evaluation",     label: "Stage 2 – Vendor Evaluation" },
  { value: "product_evaluation",    label: "Stage 4 – Product Evaluation" },
  { value: "ecosystem_evaluation",  label: "Stage 6 – Ecosystem Evaluation" },
] as const;
const TYPES = [
  { value: "scoring",    label: "Scoring" },
  { value: "commentary", label: "Commentary" },
] as const;

export function MyPromptsRepository() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<PromptRepository | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: prompts = [], isLoading } = useQuery<PromptRepository[]>({
    queryKey: ["/api/me/prompts"],
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/me/prompts/${id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Prompt deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/me/prompts"] });
    },
    onError: (err: any) => toast({ title: "Couldn't delete", description: err.message, variant: "destructive" }),
  });

  const systemPrompts = prompts.filter(p => p.isSystem);
  const myPrompts = prompts.filter(p => !p.isSystem);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">My Prompts</h2>
          <p className="text-sm text-gray-500">Author custom prompts to override system defaults in your Market Builder runs.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> New Prompt
        </Button>
      </div>

      <Section title="My Prompts" empty="You haven't created any prompts yet.">
        {myPrompts.map(p => (
          <PromptRow key={p.id} prompt={p}
            onEdit={() => setEditing(p)}
            onDelete={() => remove.mutate(p.id)}
          />
        ))}
      </Section>

      <Section title="System Defaults (read-only)">
        {systemPrompts.map(p => (
          <PromptRow key={p.id} prompt={p} systemOnly />
        ))}
      </Section>

      {(creating || editing) && (
        <PromptDialog
          open={creating || !!editing}
          prompt={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const isEmpty = arr.filter(Boolean).length === 0;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      {isEmpty && empty ? (
        <p className="text-sm text-gray-400 italic">{empty}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function PromptRow({ prompt, systemOnly, onEdit, onDelete }: {
  prompt: PromptRepository;
  systemOnly?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm text-gray-900 truncate">{prompt.name}</p>
          {prompt.isSystem && (
            <span className="text-[10px] uppercase tracking-wide rounded-full bg-gray-100 text-gray-600 px-1.5 py-0.5 inline-flex items-center gap-0.5">
              <Lock className="h-2.5 w-2.5" /> System
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-blue-50 text-blue-700 px-1.5 py-0.5">
            {prompt.stage.replace("_", " ")}
          </span>
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5">
            {prompt.promptType}
          </span>
        </div>
        {prompt.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{prompt.description}</p>
        )}
      </div>
      {!systemOnly && (
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
        </div>
      )}
    </div>
  );
}

function PromptDialog({ open, prompt, onClose }: {
  open: boolean;
  prompt: PromptRepository | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(prompt?.name ?? "");
  const [description, setDescription] = useState(prompt?.description ?? "");
  const [stage, setStage] = useState<string>(prompt?.stage ?? "vendor_evaluation");
  const [promptType, setPromptType] = useState<string>(prompt?.promptType ?? "scoring");
  const [content, setContent] = useState(prompt?.content ?? "");

  const save = useMutation({
    mutationFn: async () => {
      if (prompt) {
        return apiRequest(`/api/me/prompts/${prompt.id}`, "PATCH", { name, description, content }).then(r => r.json());
      }
      return apiRequest("/api/me/prompts", "POST", { name, description, stage, promptType, content }).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: prompt ? "Prompt updated" : "Prompt created" });
      queryClient.invalidateQueries({ queryKey: ["/api/me/prompts"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prompt ? "Edit Prompt" : "New Prompt"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input value={description ?? ""} onChange={e => setDescription(e.target.value)} />
          </div>
          {!prompt && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Stage</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={promptType} onValueChange={setPromptType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Prompt content</Label>
            <Textarea value={content} onChange={e => setContent(e.target.value)} rows={14} className="font-mono text-xs" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!name.trim() || !content.trim() || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
