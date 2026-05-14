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
import { Upload, Plus, Trash2, FileText, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
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
        </TabsList>
        <TabsContent value="markets"><MarketsTab /></TabsContent>
        <TabsContent value="vendors"><VendorsTab /></TabsContent>
        <TabsContent value="products"><ProductsTab /></TabsContent>
        <TabsContent value="review"><ReviewTab /></TabsContent>
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
        <div className="space-y-2">
          {vendors.map(v => (
            <div key={v.id} className="flex items-center justify-between p-2 border rounded">
              <div><span className="font-medium">{v.name}</span> <span className="text-xs text-muted-foreground">/{v.slug}</span></div>
              <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete ${v.name}?`)) delMut.mutate(v.id); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<DatasheetSpec> }) =>
      apiRequest(`/api/admin/datasheets/specs/${id}`, "PATCH", body),
    onSuccess: () => { refetch(); toast({ title: "Spec approved" }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Specs needing review ({specs.length})</CardTitle></CardHeader>
      <CardContent>
        {specs.length === 0 && <p className="text-sm text-muted-foreground">No specs need review.</p>}
        <div className="space-y-2">
          {specs.map(s => (
            <ReviewRow key={s.id} spec={s} onApprove={(body) => updateMut.mutate({ id: s.id, body })} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ spec, onApprove }: { spec: ReviewSpec; onApprove: (body: Partial<DatasheetSpec>) => void }) {
  const [rawValue, setRawValue] = useState(spec.rawValue ?? "");
  const [unit, setUnit] = useState(spec.unit ?? "");
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground mb-1">{spec.marketName} · {spec.vendorName} — {spec.productName}</div>
      <div className="font-medium text-sm mb-2">{spec.categoryKey}.{spec.attributeKey} <span className="text-xs text-muted-foreground">(confidence {spec.confidence})</span></div>
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
