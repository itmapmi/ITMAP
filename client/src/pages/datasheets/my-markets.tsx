import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowRight, FileText, Pencil } from "lucide-react";
import type { DatasheetMarket, DatasheetSchemaDefinition } from "@shared/schema";

function defaultSchema(): DatasheetSchemaDefinition {
  return { groups: [
    { key: "performance", label: "Performance", attributes: [
      { key: "throughput", label: "Throughput", type: "number", unit: "GB/s", higherIsBetter: true },
    ]},
    { key: "capacity", label: "Capacity", attributes: [
      { key: "max_raw", label: "Max raw capacity", type: "number", unit: "TB", higherIsBetter: true },
    ]},
  ]};
}

export default function MyDatasheetMarketsPage() {
  const { toast } = useToast();
  const { data: markets = [], isLoading } = useQuery<DatasheetMarket[]>({ queryKey: ["/api/me/datasheet-markets"] });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DatasheetMarket | null>(null);
  const delMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/me/datasheet-markets/${id}`, "DELETE"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-markets"] }); toast({ title: "Deleted" }); },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white pt-20 pb-24">
      <div className="max-w-5xl mx-auto px-6">
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium mb-3">
              <FileText className="h-3 w-3" /> Private Datasheet Markets
            </div>
            <h1 className="text-3xl font-bold mb-2">My datasheet markets</h1>
            <p className="text-slate-400 text-sm max-w-2xl">Build private hardware comparison markets only you can see. Define the spec schema, upload vendor datasheets, and our extractor pulls structured specs for side-by-side comparison.</p>
          </div>
          <Button onClick={() => setCreating(true)} className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0" data-testid="button-create-my-market">
            <Plus className="h-4 w-4 mr-1" /> New market
          </Button>
        </div>
        {isLoading && <div className="text-slate-500">Loading…</div>}
        {!isLoading && markets.length === 0 && (
          <Card className="bg-slate-900 border-white/5 p-10 text-center text-slate-500">
            No private markets yet. Create one to start uploading datasheets only you can see.
          </Card>
        )}
        <div className="space-y-3">
          {markets.map(m => (
            <Card key={m.id} className="bg-slate-900 border-white/5 p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-white" data-testid={`text-my-market-${m.slug}`}>{m.name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  /{m.slug} · {m.category || "—"} · {(m.schemaDefinition as DatasheetSchemaDefinition).groups.length} spec groups
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/me/datasheet-markets/${m.id}`}>
                  <Button variant="outline" size="sm" asChild data-testid={`button-open-my-market-${m.slug}`}>
                    <span>Manage <ArrowRight className="h-4 w-4 ml-1" /></span>
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => setEditing(m)} data-testid={`button-edit-my-market-${m.slug}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete ${m.name} and all its uploads?`)) delMut.mutate(m.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
      {creating && <CreateMarketDialog onClose={() => setCreating(false)} />}
      {editing && <EditMarketDialog market={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditMarketDialog({ market, onClose }: { market: DatasheetMarket; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(market.name);
  const [category, setCategory] = useState(market.category ?? "");
  const [description, setDescription] = useState(market.description ?? "");
  const [schemaText, setSchemaText] = useState(JSON.stringify(market.schemaDefinition, null, 2));
  const [schemaErr, setSchemaErr] = useState<string | null>(null);

  const updateMut = useMutation({
    mutationFn: async () => {
      let schemaDefinition: DatasheetSchemaDefinition;
      try { schemaDefinition = JSON.parse(schemaText); }
      catch { throw new Error("Schema JSON is invalid"); }
      if (!schemaDefinition.groups || !Array.isArray(schemaDefinition.groups) || schemaDefinition.groups.length === 0) {
        throw new Error("Schema must have at least one group");
      }
      for (const g of schemaDefinition.groups) {
        if (!g.key || !g.label || !Array.isArray(g.attributes)) throw new Error(`Group "${g.label ?? g.key ?? "?"}" is malformed`);
        for (const a of g.attributes) {
          if (!a.key || !a.label || !a.type) throw new Error(`Attribute in "${g.label}" is missing key/label/type`);
          if (!["number","text","boolean","enum"].includes(a.type)) throw new Error(`Attribute "${a.label}" has invalid type "${a.type}"`);
        }
      }
      return await apiRequest(`/api/me/datasheet-markets/${market.id}`, "PATCH", {
        name,
        category: category || null,
        description: description || null,
        schemaDefinition,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-markets"] });
      toast({ title: "Market updated" });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Update failed";
      setSchemaErr(msg);
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit market — {market.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} data-testid="input-edit-market-name" /></div>
          <div><Label>Slug (locked)</Label><Input value={market.slug} disabled /></div>
          <div><Label>Category</Label><Input value={category} onChange={e => setCategory(e.target.value)} /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
          <div>
            <Label>Schema definition (JSON)</Label>
            <Textarea
              value={schemaText}
              onChange={e => { setSchemaText(e.target.value); setSchemaErr(null); }}
              rows={18}
              className="font-mono text-xs"
              data-testid="textarea-edit-schema"
            />
            {schemaErr && <p className="text-xs text-red-500 mt-1">{schemaErr}</p>}
            <p className="text-xs text-muted-foreground mt-1">Editing the schema does not retro-extract existing datasheets. New uploads will use the updated schema.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => updateMut.mutate()} disabled={!name || updateMut.isPending} data-testid="button-save-edit-market">
            {updateMut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateMarketDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [schemaText, setSchemaText] = useState(JSON.stringify(defaultSchema(), null, 2));

  const createMut = useMutation({
    mutationFn: async () => {
      let schemaDefinition: DatasheetSchemaDefinition;
      try { schemaDefinition = JSON.parse(schemaText); }
      catch { throw new Error("Schema JSON is invalid"); }
      return await apiRequest("/api/me/datasheet-markets", "POST", { name, slug, category: category || null, description: description || null, schemaDefinition });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-markets"] }); toast({ title: "Market created" }); onClose(); },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New private datasheet market</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} data-testid="input-my-market-name" /></div>
            <div><Label>Slug</Label><Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></div>
          </div>
          <div><Label>Category</Label><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Storage, Networking" /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
          <div>
            <Label>Schema definition (JSON)</Label>
            <Textarea value={schemaText} onChange={e => setSchemaText(e.target.value)} rows={14} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">{`Shape: { groups: [{ key, label, attributes: [{ key, label, type, unit?, higherIsBetter? }] }] }`}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name || !slug || createMut.isPending} data-testid="button-save-my-market">{createMut.isPending ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
