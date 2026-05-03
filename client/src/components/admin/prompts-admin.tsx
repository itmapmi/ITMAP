import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2, FileCode2, Lock, Copy } from "lucide-react";

interface Prompt {
  id: string;
  name: string;
  description: string | null;
  promptType: "scoring" | "commentary";
  stage: "vendor_evaluation" | "product_evaluation" | "ecosystem_evaluation";
  content: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

const STAGE_LABELS: Record<Prompt["stage"], string> = {
  vendor_evaluation: "Vendor Evaluation (Stage 2)",
  product_evaluation: "Product Evaluation (Stage 4)",
  ecosystem_evaluation: "Ecosystem Evaluation (Stage 6)",
};

const TYPE_LABELS: Record<Prompt["promptType"], string> = {
  scoring: "Scoring",
  commentary: "Commentary",
};

export function PromptsAdmin() {
  const { toast } = useToast();
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: prompts = [], isLoading } = useQuery<Prompt[]>({
    queryKey: ["/api/admin/prompts"],
  });

  const filtered = prompts.filter(p =>
    (stageFilter === "all" || p.stage === stageFilter) &&
    (typeFilter === "all" || p.promptType === typeFilter)
  );

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/prompts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/prompts"] });
      toast({ title: "Prompt deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Prompt Repository</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Custom system prompts for Market Builder scoring stages. Built-in defaults are seeded automatically and cannot be deleted.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> New Prompt
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Stage</Label>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[260px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <SelectItem value="vendor_evaluation">{STAGE_LABELS.vendor_evaluation}</SelectItem>
              <SelectItem value="product_evaluation">{STAGE_LABELS.product_evaluation}</SelectItem>
              <SelectItem value="ecosystem_evaluation">{STAGE_LABELS.ecosystem_evaluation}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="scoring">Scoring</SelectItem>
              <SelectItem value="commentary">Commentary</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading prompts…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">No prompts match your filters.</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => (
            <Card key={p.id} className="border-gray-200">
              <CardHeader className="pb-2 flex-row items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {p.isSystem && <Lock className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                    <span className="truncate">{p.name}</span>
                  </CardTitle>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">{STAGE_LABELS[p.stage]}</Badge>
                    <Badge variant="outline" className="text-xs">{TYPE_LABELS[p.promptType]}</Badge>
                    {p.isSystem && <Badge variant="secondary" className="text-xs">System Default</Badge>}
                  </div>
                  {p.description && (
                    <p className="text-xs text-gray-500 mt-1">{p.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setEditing(p)} title={p.isSystem ? "View" : "Edit"}>
                    {p.isSystem ? <FileCode2 className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    title="Clone as custom"
                    onClick={() => {
                      setCreating(true);
                      setEditing({ ...p, id: "", name: `${p.name} (copy)`, isSystem: false });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {!p.isSystem && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{p.name}" will be permanently removed. Any job currently using this prompt will fall back to the system default.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate(p.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <pre className="text-xs text-gray-600 bg-gray-50 rounded border p-2.5 overflow-x-auto max-h-32 whitespace-pre-wrap font-sans">
                  {p.content.length > 350 ? `${p.content.slice(0, 350).trim()}…` : p.content}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PromptDialog
        open={creating || (editing != null && !creating && !editing.isSystem)}
        prompt={editing}
        creating={creating}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      {editing && editing.isSystem && !creating && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4 text-gray-400" />{editing.name}</DialogTitle>
              <DialogDescription>System default prompt — read-only. Use Clone to make an editable copy.</DialogDescription>
            </DialogHeader>
            <pre className="text-sm bg-gray-50 border rounded p-3 max-h-[400px] overflow-y-auto whitespace-pre-wrap font-sans">{editing.content}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PromptDialog({
  open, prompt, creating, onClose,
}: {
  open: boolean;
  prompt: Prompt | null;
  creating: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Prompt["stage"]>("vendor_evaluation");
  const [promptType, setPromptType] = useState<Prompt["promptType"]>("scoring");
  const [content, setContent] = useState("");

  // Sync form state when dialog opens
  useEffect(() => {
    if (!open) return;
    if (prompt) {
      setName(prompt.name);
      setDescription(prompt.description ?? "");
      setStage(prompt.stage);
      setPromptType(prompt.promptType);
      setContent(prompt.content);
    } else {
      setName(""); setDescription(""); setStage("vendor_evaluation");
      setPromptType("scoring"); setContent("");
    }
  }, [open, prompt]);

  const reset = () => {
    setName(""); setDescription(""); setStage("vendor_evaluation");
    setPromptType("scoring"); setContent("");
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (creating || !prompt?.id) {
        return apiRequest("POST", "/api/admin/prompts", { name, description, stage, promptType, content });
      }
      return apiRequest("PATCH", `/api/admin/prompts/${prompt.id}`, { name, description, content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/prompts"] });
      toast({ title: prompt?.id && !creating ? "Prompt updated" : "Prompt created" });
      reset();
      onClose();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (!open) return null;
  const isEdit = !!prompt?.id && !creating;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Prompt" : creating && prompt?.id === "" ? "Clone Prompt" : "New Prompt"}</DialogTitle>
          <DialogDescription>
            Custom system prompts are selectable per criterion, category, or feature when running a Market Builder job.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Strict 0-4 Scoring" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What makes this prompt different?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Stage</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as Prompt["stage"])} disabled={isEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor_evaluation">{STAGE_LABELS.vendor_evaluation}</SelectItem>
                  <SelectItem value="product_evaluation">{STAGE_LABELS.product_evaluation}</SelectItem>
                  <SelectItem value="ecosystem_evaluation">{STAGE_LABELS.ecosystem_evaluation}</SelectItem>
                </SelectContent>
              </Select>
              {isEdit && <p className="text-xs text-gray-500 mt-1">Stage cannot be changed after creation.</p>}
            </div>
            <div>
              <Label>Type</Label>
              <Select value={promptType} onValueChange={(v) => setPromptType(v as Prompt["promptType"])} disabled={isEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scoring">Scoring (numeric only)</SelectItem>
                  <SelectItem value="commentary">Commentary (justifies score in 100–250 words)</SelectItem>
                </SelectContent>
              </Select>
              {isEdit && <p className="text-xs text-gray-500 mt-1">Type cannot be changed after creation.</p>}
            </div>
          </div>
          <div>
            <Label>System Prompt Content</Label>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              placeholder="You are a senior analyst… Always respond with valid JSON only."
            />
            <p className="text-xs text-gray-500 mt-1">
              This is the system message sent to the LLM. The user message (vendor list, criteria, scores) is generated by the runner — you only override style and rubric.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || !content.trim() || saveMut.isPending}
          >
            {saveMut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
