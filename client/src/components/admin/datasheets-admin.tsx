import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { Upload, Plus, Trash2, FileText, AlertTriangle, CheckCircle2, RefreshCw, FileUp, Radar, CheckSquare, Square } from "lucide-react";
import { useEffect } from "react";
import type {
  DatasheetMarket, DatasheetVendor, DatasheetProduct,
  DatasheetSchemaDefinition, DatasheetSpec, Datasheet,
} from "@shared/schema";

type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };

export default function DatasheetsAdmin() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Datasheet Comparison</h2>
        <p className="text-sm text-muted-foreground">Manage hardware markets, vendors, products, and uploaded datasheets.</p>
      </div>
      <Tabs defaultValue="markets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="markets">Markets</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="products">Products & Uploads</TabsTrigger>
          <TabsTrigger value="review">Review Queue</TabsTrigger>
          <TabsTrigger value="import">Bulk Import</TabsTrigger>
          <TabsTrigger value="rediscover">Rediscovery</TabsTrigger>
        </TabsList>
        <TabsContent value="markets"><MarketsTab /></TabsContent>
        <TabsContent value="vendors"><VendorsTab /></TabsContent>
        <TabsContent value="products"><ProductsTab /></TabsContent>
        <TabsContent value="review"><ReviewTab /></TabsContent>
        <TabsContent value="import"><BulkImportTab /></TabsContent>
        <TabsContent value="rediscover"><RediscoveryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Markets ──────────────────────────────────────────────────────────────
function MarketsTab() {
  const { toast } = useToast();
  const { data: markets = [], isLoading } = useQuery<DatasheetMarket[]>({ queryKey: ["/api/admin/datasheets/markets"] });
  const [editing, setEditing] = useState<DatasheetMarket | null>(null);
  const [creating, setCreating] = useState(false);

  const delMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/datasheets/markets/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/markets"] });
      toast({ title: "Market deleted" });
    },
  });

  if (isLoading) return <div>Loading…</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Datasheet Markets</CardTitle>
        <Button onClick={() => setCreating(true)} data-testid="button-create-market"><Plus className="h-4 w-4 mr-1" />New Market</Button>
      </CardHeader>
      <CardContent>
        {markets.length === 0 && <p className="text-sm text-muted-foreground">No markets yet. Create one to start uploading datasheets.</p>}
        <div className="space-y-2">
          {markets.map(m => (
            <div key={m.id} className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">{m.name} <Badge variant={m.isVisible ? "default" : "secondary"} className="ml-2">{m.isVisible ? "Visible" : "Hidden"}</Badge></div>
                <div className="text-xs text-muted-foreground">/{m.slug} · {m.category || "—"} · {(m.schemaDefinition as DatasheetSchemaDefinition).groups.length} groups</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(m)} data-testid={`button-edit-market-${m.slug}`}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete ${m.name}?`)) delMut.mutate(m.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      {(creating || editing) && (
        <MarketDialog
          market={editing}
          open={true}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </Card>
  );
}

function MarketDialog({ market, open, onClose }: { market: DatasheetMarket | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(market?.name ?? "");
  const [slug, setSlug] = useState(market?.slug ?? "");
  const [category, setCategory] = useState(market?.category ?? "");
  const [description, setDescription] = useState(market?.description ?? "");
  const [isVisible, setIsVisible] = useState(market?.isVisible ?? true);
  const [schemaText, setSchemaText] = useState(JSON.stringify(market?.schemaDefinition ?? defaultSchema(), null, 2));

  const saveMut = useMutation({
    mutationFn: async () => {
      let schemaDefinition: DatasheetSchemaDefinition;
      try { schemaDefinition = JSON.parse(schemaText); }
      catch { throw new Error("Schema JSON is invalid"); }
      const body = { name, slug, category: category || null, description: description || null, schemaDefinition, isVisible };
      if (market) return await apiRequest(`/api/admin/datasheets/markets/${market.id}`, "PATCH", body);
      return await apiRequest("/api/admin/datasheets/markets", "POST", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/markets"] });
      toast({ title: market ? "Market updated" : "Market created" });
      onClose();
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{market ? "Edit Market" : "New Datasheet Market"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} data-testid="input-market-name" /></div>
            <div><Label>Slug</Label><Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></div>
          </div>
          <div><Label>Category</Label><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Storage, Networking" /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="visible" checked={isVisible} onChange={e => setIsVisible(e.target.checked)} />
            <Label htmlFor="visible">Visible to users</Label>
          </div>
          <div>
            <Label>Schema definition (JSON)</Label>
            <Textarea value={schemaText} onChange={e => setSchemaText(e.target.value)} rows={16} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">Shape: {`{ groups: [{ key, label, attributes: [{ key, label, type: "number"|"text"|"boolean"|"enum", unit?, higherIsBetter?, options? }] }] }`}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-market">{saveMut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultSchema(): DatasheetSchemaDefinition {
  return {
    groups: [
      { key: "performance", label: "Performance", attributes: [
        { key: "max_iops", label: "Max IOPS", type: "number", unit: "IOPS", higherIsBetter: true },
        { key: "throughput", label: "Throughput", type: "number", unit: "GB/s", higherIsBetter: true },
      ]},
      { key: "capacity", label: "Capacity", attributes: [
        { key: "max_raw_capacity", label: "Max raw capacity", type: "number", unit: "TB", higherIsBetter: true },
      ]},
    ],
  };
}

// ── Vendors ──────────────────────────────────────────────────────────────
function VendorsTab() {
  const { toast } = useToast();
  const { data: vendors = [] } = useQuery<DatasheetVendor[]>({ queryKey: ["/api/admin/datasheets/vendors"] });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [website, setWebsite] = useState("");
  const createMut = useMutation({
    mutationFn: () => apiRequest("/api/admin/datasheets/vendors", "POST", { name, slug, website: website || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/vendors"] });
      setName(""); setSlug(""); setWebsite("");
      toast({ title: "Vendor created" });
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/datasheets/vendors/${id}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/vendors"] }),
  });
  const optInMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { rediscoveryOptIn?: boolean; productIndexUrl?: string | null } }) =>
      apiRequest(`/api/admin/datasheets/vendors/${id}/rediscovery`, "PATCH", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/vendors"] }),
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Vendors</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Slug" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          <Input placeholder="Website (optional)" value={website} onChange={e => setWebsite(e.target.value)} />
          <Button onClick={() => createMut.mutate()} disabled={!name || !slug || createMut.isPending}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Toggle <strong>Auto-rediscover</strong> + paste the vendor's product index URL to enrol them in the weekly re-extraction cron.
        </p>
        <div className="space-y-2">
          {vendors.map(v => (
            <VendorRow key={v.id} vendor={v}
              onDelete={() => { if (confirm(`Delete ${v.name}?`)) delMut.mutate(v.id); }}
              onSave={(body) => optInMut.mutate({ id: v.id, body })}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VendorRow({ vendor, onDelete, onSave }: {
  vendor: DatasheetVendor;
  onDelete: () => void;
  onSave: (body: { rediscoveryOptIn?: boolean; productIndexUrl?: string | null }) => void;
}) {
  const [optIn, setOptIn] = useState(!!vendor.rediscoveryOptIn);
  const [url, setUrl] = useState(vendor.productIndexUrl ?? "");
  useEffect(() => { setOptIn(!!vendor.rediscoveryOptIn); setUrl(vendor.productIndexUrl ?? ""); }, [vendor.id, vendor.rediscoveryOptIn, vendor.productIndexUrl]);
  const dirty = optIn !== !!vendor.rediscoveryOptIn || (url || "") !== (vendor.productIndexUrl ?? "");
  return (
    <div className="border rounded p-2">
      <div className="flex items-center justify-between">
        <div><span className="font-medium">{vendor.name}</span> <span className="text-xs text-muted-foreground">/{vendor.slug}</span></div>
        <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center mt-2">
        <label className="text-xs flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} data-testid={`checkbox-optin-${vendor.slug}`} />
          Auto-rediscover
        </label>
        <Input placeholder="Product index URL (e.g. https://vendor.com/products)" value={url} onChange={e => setUrl(e.target.value)} disabled={!optIn} />
        <Button variant="outline" size="sm" disabled={!dirty} onClick={() => onSave({ rediscoveryOptIn: optIn, productIndexUrl: optIn ? (url || null) : null })}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Products + Uploads ───────────────────────────────────────────────────
function ProductsTab() {
  const { data: markets = [] } = useQuery<DatasheetMarket[]>({ queryKey: ["/api/admin/datasheets/markets"] });
  const { data: vendors = [] } = useQuery<DatasheetVendor[]>({ queryKey: ["/api/admin/datasheets/vendors"] });
  const [marketId, setMarketId] = useState<string>("");

  return (
    <Card>
      <CardHeader><CardTitle>Products & Datasheet Uploads</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 max-w-md">
          <Label>Market</Label>
          <Select value={marketId} onValueChange={setMarketId}>
            <SelectTrigger data-testid="select-product-market"><SelectValue placeholder="Select a market" /></SelectTrigger>
            <SelectContent>{markets.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {marketId && <ProductsForMarket marketId={marketId} vendors={vendors} />}
      </CardContent>
    </Card>
  );
}

function ProductsForMarket({ marketId, vendors }: { marketId: string; vendors: DatasheetVendor[] }) {
  const { toast } = useToast();
  const { data: products = [] } = useQuery<ProductWithVendor[]>({
    queryKey: ["/api/admin/datasheets/products", marketId],
    queryFn: async () => (await apiRequest(`/api/admin/datasheets/products?marketId=${marketId}`, "GET")).json(),
  });
  const [vendorId, setVendorId] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const createMut = useMutation({
    mutationFn: () => apiRequest("/api/admin/datasheets/products", "POST", { marketId, vendorId, name, slug }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/products", marketId] });
      setVendorId(""); setName(""); setSlug("");
      toast({ title: "Product created" });
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/datasheets/products/${id}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/products", marketId] }),
  });

  return (
    <div className="space-y-4">
      <div className="border rounded-md p-3 bg-slate-50 grid grid-cols-4 gap-2">
        <Select value={vendorId} onValueChange={setVendorId}>
          <SelectTrigger><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Product name" value={name} onChange={e => setName(e.target.value)} />
        <Input placeholder="Slug" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
        <Button onClick={() => createMut.mutate()} disabled={!vendorId || !name || !slug || createMut.isPending}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      <div className="space-y-3">
        {products.map(p => (
          <ProductRow key={p.id} product={p} onDelete={() => { if (confirm(`Delete ${p.name}?`)) delMut.mutate(p.id); }} />
        ))}
      </div>
    </div>
  );
}

function ProductRow({ product, onDelete }: { product: ProductWithVendor; onDelete: () => void }) {
  const { toast } = useToast();
  const { data: datasheets = [], refetch } = useQuery<Datasheet[]>({
    queryKey: ["/api/admin/datasheets/products", product.id, "datasheets"],
    queryFn: async () => (await apiRequest(`/api/admin/datasheets/products/${product.id}/datasheets`, "GET")).json(),
  });

  const uploadMut = useMutation({
    mutationFn: (uploadURL: string) =>
      apiRequest(`/api/admin/datasheets/products/${product.id}/datasheets`, "POST", { uploadURL }),
    onSuccess: () => {
      refetch();
      toast({ title: "Datasheet uploaded and extracted" });
    },
    onError: (err: unknown) => toast({ title: "Upload failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const reExtractMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/datasheets/datasheets/${id}/re-extract`, "POST"),
    onSuccess: () => { refetch(); toast({ title: "Re-extracted" }); },
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{product.vendor.name} — {product.name}</div>
            <div className="text-xs text-muted-foreground">/{product.slug}</div>
          </div>
          <div className="flex gap-2">
            <ObjectUploader
              maxNumberOfFiles={1}
              maxFileSize={20 * 1024 * 1024}
              onGetUploadParameters={async () => {
                const res = await apiRequest("/api/objects/upload", "POST");
                const data = await res.json();
                return { method: "PUT", url: data.uploadURL };
              }}
              onComplete={(result) => {
                const f = result.successful?.[0];
                if (f?.uploadURL) uploadMut.mutate(f.uploadURL);
              }}
            >
              <span className="inline-flex items-center"><Upload className="h-4 w-4 mr-1" /> Upload PDF</span>
            </ObjectUploader>
            <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        {datasheets.length === 0 && <div className="text-xs text-muted-foreground">No datasheets uploaded.</div>}
        <div className="space-y-2">
          {datasheets.map(d => (
            <div key={d.id} className="flex items-center justify-between text-sm p-2 bg-slate-50 rounded">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span>v{d.version}</span>
                {d.isCurrent && <Badge variant="default" className="text-xs">Current</Badge>}
                <StatusBadge status={d.extractionStatus} />
                {d.pageCount && <span className="text-xs text-muted-foreground">{d.pageCount} pages</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => window.open(d.fileUrl, "_blank")}>View PDF</Button>
                <Button variant="outline" size="sm" onClick={() => reExtractMut.mutate(d.id)} disabled={reExtractMut.isPending}>
                  <RefreshCw className="h-3 w-3 mr-1" />Re-extract
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "extracted") return <Badge variant="default" className="bg-emerald-600 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Extracted</Badge>;
  if (status === "extracting") return <Badge variant="secondary" className="text-xs">Extracting…</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="text-xs">Failed</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ── Review Queue ─────────────────────────────────────────────────────────
type ReviewSpec = DatasheetSpec & { productName: string; vendorName: string; marketName: string; marketId: string };

function ReviewTab() {
  const { toast } = useToast();
  const { data: specs = [], refetch } = useQuery<ReviewSpec[]>({ queryKey: ["/api/admin/datasheets/review-queue"] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(0);

  // Drop selections that are no longer in the queue (e.g. after approve refetch).
  useEffect(() => {
    setSelected(prev => {
      const stillThere = new Set(specs.map(s => s.id));
      const next = new Set<string>();
      prev.forEach(id => { if (stillThere.has(id)) next.add(id); });
      return next;
    });
    if (focused >= specs.length) setFocused(Math.max(0, specs.length - 1));
  }, [specs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<DatasheetSpec> }) =>
      apiRequest(`/api/admin/datasheets/specs/${id}`, "PATCH", body),
    onSuccess: () => { refetch(); toast({ title: "Spec approved" }); },
  });
  const bulkMut = useMutation({
    mutationFn: ({ ids, body }: { ids: string[]; body: Partial<DatasheetSpec> }) =>
      apiRequest(`/api/admin/datasheets/specs/bulk`, "PATCH", { ids, body }),
    onSuccess: (_, vars) => { refetch(); setSelected(new Set()); toast({ title: `${vars.ids.length} specs updated` }); },
    onError: (err: unknown) => toast({ title: "Bulk update failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });
  const bulkRejectMut = useMutation({
    mutationFn: ({ ids }: { ids: string[] }) =>
      apiRequest(`/api/admin/datasheets/specs/bulk`, "DELETE", { ids }),
    onSuccess: (_, vars) => { refetch(); setSelected(new Set()); toast({ title: `${vars.ids.length} specs rejected` }); },
    onError: (err: unknown) => toast({ title: "Bulk reject failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  // Keyboard navigation: ↑/↓ move focus, space toggles selection, A selects all,
  // Enter approves currently-focused row as-is.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (specs.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setFocused(f => Math.min(f + 1, specs.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setFocused(f => Math.max(0, f - 1)); }
      else if (e.key === " ") {
        e.preventDefault();
        const id = specs[focused]?.id; if (!id) return;
        setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
      } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelected(new Set(specs.map(s => s.id)));
      } else if (e.key === "Enter") {
        const s = specs[focused]; if (!s) return;
        updateMut.mutate({ id: s.id, body: { rawValue: s.rawValue, unit: s.unit, needsReview: false } });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [specs, focused, updateMut]);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = Array.from(selected);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Specs needing review ({specs.length})</span>
          <div className="flex items-center gap-2 text-xs font-normal">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set(specs.map(s => s.id)))} data-testid="button-select-all">
              <CheckSquare className="h-4 w-4 mr-1" />Select all
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={ids.length === 0}>
              <Square className="h-4 w-4 mr-1" />Clear
            </Button>
            <Button size="sm" disabled={ids.length === 0 || bulkMut.isPending}
              onClick={() => bulkMut.mutate({ ids, body: { needsReview: false } })}
              data-testid="button-bulk-approve">
              Approve {ids.length} as-is
            </Button>
            <Button size="sm" variant="destructive"
              disabled={ids.length === 0 || bulkRejectMut.isPending}
              onClick={() => {
                if (!confirm(`Reject (delete) ${ids.length} spec(s)? This cannot be undone.`)) return;
                bulkRejectMut.mutate({ ids });
              }}
              data-testid="button-bulk-reject">
              Reject {ids.length}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {specs.length === 0 && <p className="text-sm text-muted-foreground">No specs need review.</p>}
        <p className="text-xs text-muted-foreground mb-2">Keyboard: ↑/↓ navigate · Space toggle · Cmd/Ctrl+A select all · Enter approve focused row.</p>
        <div className="space-y-2">
          {specs.map((s, i) => (
            <ReviewRow key={s.id}
              spec={s}
              focused={i === focused}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggle(s.id)}
              onFocus={() => setFocused(i)}
              onApprove={(body) => updateMut.mutate({ id: s.id, body })}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ spec, focused, selected, onToggleSelect, onFocus, onApprove }: {
  spec: ReviewSpec; focused: boolean; selected: boolean;
  onToggleSelect: () => void; onFocus: () => void;
  onApprove: (body: Partial<DatasheetSpec>) => void;
}) {
  const [rawValue, setRawValue] = useState(spec.rawValue ?? "");
  const [unit, setUnit] = useState(spec.unit ?? "");
  return (
    <div
      onClick={onFocus}
      className={`border rounded-md p-3 ${focused ? "ring-2 ring-cyan-500/40 border-cyan-500/40" : ""} ${selected ? "bg-cyan-500/5" : ""}`}
      data-testid={`row-review-${spec.id}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} onClick={e => e.stopPropagation()} data-testid={`checkbox-review-${spec.id}`} />
          <div className="text-xs text-muted-foreground">{spec.marketName} · {spec.vendorName} — {spec.productName}</div>
        </div>
        <div className="text-xs text-muted-foreground">confidence {spec.confidence}</div>
      </div>
      <div className="font-medium text-sm mb-2">{spec.categoryKey}.{spec.attributeKey}</div>
      {spec.sourceQuote && <div className="text-xs italic text-muted-foreground mb-2">"{spec.sourceQuote}" {spec.sourcePage && `(p. ${spec.sourcePage})`}</div>}
      <div className="grid grid-cols-4 gap-2">
        <Input value={rawValue} onChange={e => setRawValue(e.target.value)} placeholder="Value" />
        <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" />
        <Button onClick={() => onApprove({ rawValue, unit, needsReview: false })}>Approve</Button>
        <Button variant="ghost" onClick={() => onApprove({ rawValue: null, needsReview: false })}>Mark not-found</Button>
      </div>
    </div>
  );
}

// ── Bulk CSV import ──────────────────────────────────────────────────────
function BulkImportTab() {
  const { toast } = useToast();
  const { data: markets = [] } = useQuery<DatasheetMarket[]>({ queryKey: ["/api/admin/datasheets/markets"] });
  const [marketId, setMarketId] = useState("");
  const [csv, setCsv] = useState("");
  const [plan, setPlan] = useState<{ vendors: { name: string; slug: string; action: string }[]; products: { vendorSlug: string; name: string; slug: string; datasheetUrl: string | null; action: string; error?: string }[]; warnings: string[] } | null>(null);
  type CommitResult = { vendorsCreated: number; productsCreated: number; productsSkipped: number; datasheetsIngested: number; datasheetsFailed: number; errors: string[] };
  const [commitSummary, setCommitSummary] = useState<CommitResult | null>(null);

  const dryMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/datasheets/import/csv", "POST", { marketId, csv, dryRun: true });
      return await res.json();
    },
    onSuccess: (data) => { setPlan(data); setCommitSummary(null); },
    onError: (err: unknown) => toast({ title: "Plan failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });
  const commitMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/datasheets/import/csv", "POST", { marketId, csv, dryRun: false });
      return await res.json() as { result: CommitResult };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/products", marketId] });
      const r = data.result;
      setCommitSummary(r);
      const failed = r.datasheetsFailed > 0;
      toast({
        title: failed ? "Import finished with errors" : "Import complete",
        description: `Vendors +${r.vendorsCreated} · Products +${r.productsCreated} (${r.productsSkipped} skipped) · Datasheets +${r.datasheetsIngested}${failed ? ` · ${r.datasheetsFailed} failed` : ""}`,
        variant: failed ? "destructive" : "default",
      });
      setCsv(""); setPlan(null);
    },
    onError: (err: unknown) => toast({ title: "Import failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" />Bulk CSV import</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Columns: <code>vendor_name,vendor_slug,product_name,product_slug,datasheet_url</code>.
          Vendor rows are upserted by slug; product rows are created in the selected market. Each datasheet URL is downloaded and extracted inline as part of this request — only public, robots-allowed PDF URLs. Large imports may take a minute.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Market</Label>
            <Select value={marketId} onValueChange={setMarketId}>
              <SelectTrigger><SelectValue placeholder="Select a market" /></SelectTrigger>
              <SelectContent>{markets.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>CSV content</Label>
          <Textarea value={csv} onChange={e => setCsv(e.target.value)} rows={10} className="font-mono text-xs"
            placeholder={`vendor_name,vendor_slug,product_name,product_slug,datasheet_url\nAcme,acme,Acme Switch X100,switch-x100,https://acme.com/sw/x100.pdf`} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => dryMut.mutate()} disabled={!marketId || !csv || dryMut.isPending}>Preview plan</Button>
          <Button onClick={() => commitMut.mutate()} disabled={!plan || commitMut.isPending}
            className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0" data-testid="button-commit-import">
            {commitMut.isPending ? "Importing…" : "Commit import"}
          </Button>
        </div>
        {plan && (
          <div className="rounded-md border p-3 text-xs space-y-2 bg-slate-50">
            {plan.warnings.length > 0 && <div className="text-amber-700">Warnings: {plan.warnings.join("; ")}</div>}
            <div className="font-semibold">Vendors ({plan.vendors.length})</div>
            {plan.vendors.map((v, i) => <div key={i}>{v.action} · {v.name} ({v.slug})</div>)}
            <div className="font-semibold mt-2">Products ({plan.products.length})</div>
            {plan.products.map((p, i) => (
              <div key={i} className={p.error ? "text-rose-700" : ""}>
                {p.action} · {p.vendorSlug}/{p.slug} {p.datasheetUrl ? `← ${p.datasheetUrl}` : ""} {p.error ? `(${p.error})` : ""}
              </div>
            ))}
          </div>
        )}
        {commitSummary && (
          <div className="rounded-md border p-3 text-xs space-y-1 bg-slate-50">
            <div className="font-semibold">Import result</div>
            <div>Vendors created: {commitSummary.vendorsCreated}</div>
            <div>Products created: {commitSummary.productsCreated} (skipped {commitSummary.productsSkipped})</div>
            <div>
              Datasheets ingested: <span className="font-medium">{commitSummary.datasheetsIngested}</span>
              {commitSummary.datasheetsFailed > 0 && <span className="text-rose-700"> · failed: {commitSummary.datasheetsFailed}</span>}
            </div>
            {commitSummary.errors.length > 0 && (
              <div className="mt-2">
                <div className="font-semibold text-rose-700">Per-row errors</div>
                <ul className="list-disc pl-5 text-rose-700 space-y-0.5">
                  {commitSummary.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Admin-assisted rediscovery ───────────────────────────────────────────
type AgentRun = {
  id: string; runType: string; vendorId: string; productId: string | null;
  status: string; inputUrl: string | null; outputJson: unknown;
  errorMessage: string | null; durationMs: number | null; createdAt: string;
};
type Candidate = { productName: string; candidateDatasheetUrl: string; confidence: number };

function RediscoveryTab() {
  const { toast } = useToast();
  const { data: vendors = [] } = useQuery<DatasheetVendor[]>({ queryKey: ["/api/admin/datasheets/vendors"] });
  const { data: runs = [] } = useQuery<AgentRun[]>({ queryKey: ["/api/admin/datasheets/agent-runs"] });
  const [vendorId, setVendorId] = useState("");
  const [productIndexUrl, setProductIndexUrl] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const runMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/datasheets/rediscover", "POST", { vendorId, productIndexUrl });
      return await res.json() as { candidates: Candidate[] };
    },
    onSuccess: (data) => {
      setCandidates(data.candidates);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/agent-runs"] });
      toast({ title: `Found ${data.candidates.length} candidates` });
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: ({ productId, url }: { productId: string; url: string }) =>
      apiRequest("/api/admin/datasheets/rediscover/approve", "POST", { vendorId, productId, url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/datasheets/agent-runs"] });
      toast({ title: "Datasheet ingested" });
    },
    onError: (err: unknown) => toast({ title: "Ingest failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const { data: vendorProducts = [] } = useQuery<ProductWithVendor[]>({
    queryKey: ["/api/admin/datasheets/products-for-vendor", vendorId],
    queryFn: async () => vendorId ? (await apiRequest(`/api/admin/datasheets/products?vendorId=${vendorId}`, "GET")).json() : [],
    enabled: !!vendorId,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Radar className="h-5 w-5" />Admin-assisted rediscovery</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Fetches the vendor's product index page (robots.txt is honoured + a polite per-host delay is enforced), asks GPT-4.1 to surface likely datasheet URLs, then lets you assign each candidate to one of your existing products. Approval downloads and extracts via the standard pipeline.
          </p>
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Vendor" /></SelectTrigger>
              <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="https://vendor.com/products" value={productIndexUrl} onChange={e => setProductIndexUrl(e.target.value)} />
            <Button onClick={() => runMut.mutate()} disabled={!vendorId || !productIndexUrl || runMut.isPending} data-testid="button-rediscover">
              {runMut.isPending ? "Running…" : "Discover"}
            </Button>
          </div>
          {candidates && (
            <div className="border rounded-md p-3 space-y-2 text-sm">
              <div className="font-semibold text-xs text-muted-foreground">Candidates</div>
              {candidates.length === 0 && <div className="text-xs text-muted-foreground">No candidates returned.</div>}
              {candidates.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_1fr_auto] gap-2 items-center">
                  <div className="text-xs truncate" title={c.productName}>{c.productName}</div>
                  <a href={c.candidateDatasheetUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-700 truncate underline">{c.candidateDatasheetUrl}</a>
                  <Select onValueChange={(productId) => approveMut.mutate({ productId, url: c.candidateDatasheetUrl })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign to product" /></SelectTrigger>
                    <SelectContent>{vendorProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Badge variant="outline" className="text-xs">{Math.round(c.confidence * 100)}%</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent agent runs</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 && <div className="text-xs text-muted-foreground">No runs yet.</div>}
          <div className="space-y-1 text-xs">
            {runs.slice(0, 30).map(r => (
              <div key={r.id} className="flex items-center justify-between border-b py-1">
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "success" ? "default" : r.status === "failed" ? "destructive" : "secondary"} className="text-xs">{r.status}</Badge>
                  <span className="text-muted-foreground">{r.runType}</span>
                  {r.inputUrl && <span className="truncate max-w-[480px]">{r.inputUrl}</span>}
                  {r.errorMessage && <span className="text-rose-600 truncate max-w-[280px]">{r.errorMessage}</span>}
                </div>
                <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
