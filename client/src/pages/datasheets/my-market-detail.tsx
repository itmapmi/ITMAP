import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, Upload, CheckCircle2 } from "lucide-react";
import type { DatasheetMarket, DatasheetVendor, DatasheetProduct, Datasheet } from "@shared/schema";

type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };
type MarketDetail = { market: DatasheetMarket; products: ProductWithVendor[] };

export default function MyDatasheetMarketDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<MarketDetail>({
    queryKey: ["/api/me/datasheet-markets", params.id],
    queryFn: async () => (await apiRequest(`/api/me/datasheet-markets/${params.id}`, "GET")).json(),
  });
  // Vendors are shared globally — same vendor can appear in any market.
  const { data: vendors = [] } = useQuery<DatasheetVendor[]>({ queryKey: ["/api/datasheets/vendors"] });

  const [vendorId, setVendorId] = useState("");
  const [productName, setProductName] = useState("");
  const [productSlug, setProductSlug] = useState("");

  // Vendor creation dialog state (user-scoped vendors, slug auto-namespaced by API)
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorSlug, setNewVendorSlug] = useState("");
  const [newVendorWebsite, setNewVendorWebsite] = useState("");

  const createVendorMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/me/datasheet-markets/${params.id}/vendors`, "POST", {
        name: newVendorName, slug: newVendorSlug,
        website: newVendorWebsite ? newVendorWebsite : null,
      });
      return res.json() as Promise<DatasheetVendor>;
    },
    onSuccess: (v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/datasheets/vendors"] });
      setVendorDialogOpen(false);
      setNewVendorName(""); setNewVendorSlug(""); setNewVendorWebsite("");
      // Auto-select the newly created vendor in the add-product form.
      setVendorId(v.id);
      toast({ title: "Vendor created" });
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const createProductMut = useMutation({
    mutationFn: () => apiRequest(`/api/me/datasheet-markets/${params.id}/products`, "POST", { vendorId, name: productName, slug: productSlug }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-markets", params.id] });
      setVendorId(""); setProductName(""); setProductSlug("");
      toast({ title: "Product added" });
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const deleteProductMut = useMutation({
    mutationFn: (productId: string) => apiRequest(`/api/me/datasheet-markets/${params.id}/products/${productId}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-markets", params.id] }),
  });

  if (isLoading) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Loading…</div>;
  if (!data) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Market not found.</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-white pt-20 pb-24">
      <div className="max-w-5xl mx-auto px-6">
        <Link href="/me/datasheet-markets"><Button variant="ghost" size="sm" className="text-slate-400 mb-4"><ArrowLeft className="h-4 w-4 mr-1" />All my markets</Button></Link>
        <div className="mb-6">
          <h1 className="text-3xl font-bold">{data.market.name}</h1>
          {data.market.description && <p className="text-slate-400 mt-1 text-sm">{data.market.description}</p>}
        </div>

        <Card className="bg-slate-900 border-white/5 p-4 mb-6">
          <div className="text-sm font-semibold mb-3 text-slate-200">Add a product</div>
          <div className="grid grid-cols-4 gap-2">
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger data-testid="select-vendor"><SelectValue placeholder="Vendor" /></SelectTrigger>
              <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Product name" value={productName} onChange={e => setProductName(e.target.value)} />
            <Input placeholder="Slug" value={productSlug} onChange={e => setProductSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
            <Button onClick={() => createProductMut.mutate()} disabled={!vendorId || !productName || !productSlug || createProductMut.isPending} data-testid="button-add-product">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-slate-500">Pick a vendor, or add your own — it will be scoped to your account.</p>
            <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-open-create-vendor">
                  <Plus className="h-3.5 w-3.5 mr-1" /> New vendor
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-900 border-white/10 text-slate-100">
                <DialogHeader><DialogTitle>Create a vendor</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-slate-400">Name</Label>
                    <Input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="Acme Networks" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Slug</Label>
                    <Input value={newVendorSlug} onChange={e => setNewVendorSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="acme-networks" />
                    <p className="text-[11px] text-slate-500 mt-1">We'll automatically namespace this to your account.</p>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Website (optional)</Label>
                    <Input value={newVendorWebsite} onChange={e => setNewVendorWebsite(e.target.value)} placeholder="https://acme.com" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setVendorDialogOpen(false)}>Cancel</Button>
                  <Button
                    disabled={!newVendorName || !newVendorSlug || createVendorMut.isPending}
                    onClick={() => createVendorMut.mutate()}
                    data-testid="button-create-vendor"
                  >Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Card>

        <div className="space-y-3">
          {data.products.length === 0 && (
            <Card className="bg-slate-900 border-white/5 p-10 text-center text-slate-500">No products yet.</Card>
          )}
          {data.products.map(p => (
            <MyProductRow key={p.id} marketId={params.id!} product={p} onDelete={() => { if (confirm(`Delete ${p.name}?`)) deleteProductMut.mutate(p.id); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MyProductRow({ marketId, product, onDelete }: { marketId: string; product: ProductWithVendor; onDelete: () => void }) {
  const { toast } = useToast();
  const { data: datasheets = [], refetch } = useQuery<Datasheet[]>({
    queryKey: ["/api/me/datasheet-markets", marketId, "products", product.id, "datasheets"],
    queryFn: async () => (await apiRequest(`/api/me/datasheet-markets/${marketId}/products/${product.id}/datasheets`, "GET")).json(),
  });

  const uploadMut = useMutation({
    mutationFn: (uploadURL: string) =>
      apiRequest(`/api/me/datasheet-markets/${marketId}/products/${product.id}/datasheets`, "POST", { uploadURL }),
    onSuccess: () => { refetch(); toast({ title: "Datasheet uploaded and extracted" }); },
    onError: (err: unknown) => toast({ title: "Upload failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Card className="bg-slate-900 border-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-medium">{product.vendor.name} — {product.name}</div>
          <div className="text-xs text-slate-500">/{product.slug}</div>
        </div>
        <div className="flex gap-2">
          <ObjectUploader
            maxNumberOfFiles={1}
            maxFileSize={20 * 1024 * 1024}
            onGetUploadParameters={async () => {
              const res = await apiRequest("/api/objects/upload", "POST");
              const d = await res.json();
              return { method: "PUT", url: d.uploadURL };
            }}
            onComplete={(result) => { const f = result.successful?.[0]; if (f?.uploadURL) uploadMut.mutate(f.uploadURL); }}
          >
            <span className="inline-flex items-center"><Upload className="h-4 w-4 mr-1" />Upload PDF</span>
          </ObjectUploader>
          <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="space-y-2">
        {datasheets.length === 0 && <div className="text-xs text-slate-500">No datasheets uploaded yet.</div>}
        {datasheets.map(d => (
          <div key={d.id} className="flex items-center justify-between text-sm p-2 bg-slate-950/60 rounded">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              <span>v{d.version}</span>
              {d.isCurrent && <Badge variant="default" className="text-xs bg-cyan-500 text-slate-950">Current</Badge>}
              <Badge variant={d.extractionStatus === "extracted" ? "default" : d.extractionStatus === "failed" ? "destructive" : "secondary"} className="text-xs">
                {d.extractionStatus === "extracted" && <CheckCircle2 className="h-3 w-3 mr-1" />}{d.extractionStatus}
              </Badge>
              {d.pageCount && <span className="text-xs text-slate-500">{d.pageCount} pages</span>}
            </div>
            <Button variant="outline" size="sm" onClick={() => window.open(d.fileUrl, "_blank")}>View PDF</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
