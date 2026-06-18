import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { track, trackDwell } from "@/lib/track";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import { Send, Bookmark, Download, FileSpreadsheet, FileText, MessageSquare, X, Plus, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type {
  DatasheetMarket, DatasheetProduct, DatasheetVendor, Datasheet, DatasheetSpec,
  DatasheetSchemaDefinition, DatasheetCitation, DatasheetChatConversation, DatasheetChatMessage, Market,
} from "@shared/schema";

// Set up pdf.js worker — use the CDN matching the installed pdfjs version.
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };
type MarketDetail = { market: DatasheetMarket; products: ProductWithVendor[] };
type CompareData = { products: ProductWithVendor[]; datasheets: Datasheet[]; specs: DatasheetSpec[] };

export default function DatasheetComparePage() {
  const params = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, hasFeature, isLoading: authLoading } = useAuth();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [filterVendor, setFilterVendor] = useState<string>("");
  const [filterSubCategory, setFilterSubCategory] = useState<string>("");
  const [filterFormFactor, setFilterFormFactor] = useState<string>("");
  const [showSendToRfp, setShowSendToRfp] = useState(false);

  const { data: marketDetail, isLoading } = useQuery<MarketDetail>({
    queryKey: ["/api/datasheets/markets", params.slug],
    queryFn: async () => (await apiRequest(`/api/datasheets/markets/${params.slug}`, "GET")).json(),
    enabled: hasFeature("datasheets"),
  });

  // Initialize default selection from ?ids= query string, or first 2 products.
  // Also bump lastViewedAt when a saved comparison is opened (?comparisonId=)
  // so the saved-comparisons list reflects real usage.
  useEffect(() => {
    if (marketDetail && selectedIds.length === 0) {
      const qs = new URLSearchParams(window.location.search);
      const ids = qs.get("ids");
      const validIds = new Set(marketDetail.products.map(p => p.id));
      const fromQs = ids ? ids.split(",").filter(id => validIds.has(id)).slice(0, 5) : [];
      if (fromQs.length > 0) { setSelectedIds(fromQs); }
      else {
        const defaults = marketDetail.products.slice(0, Math.min(2, marketDetail.products.length)).map(p => p.id);
        if (defaults.length) setSelectedIds(defaults);
      }
      const comparisonId = qs.get("comparisonId");
      if (comparisonId && isAuthenticated) {
        // Fire-and-forget — failures don't affect viewing.
        apiRequest(`/api/me/datasheet-comparisons/${comparisonId}`, "PATCH", { touch: true }).catch(() => {});
      }
    }
  }, [marketDetail, selectedIds.length, isAuthenticated]);

  const compareMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("/api/datasheets/compare", "POST", { productIds: ids });
      return (await res.json()) as CompareData;
    },
  });
  useEffect(() => {
    if (selectedIds.length >= 2) compareMut.mutate(selectedIds);
    else compareMut.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(",")]);

  const data = compareMut.data;
  const market = marketDetail?.market;

  // Track page visit and dwell time once the market is resolved.
  // Declared after `market` to avoid temporal dead zone issues.
  useEffect(() => {
    if (!market) return;
    track("market_viewed", { metadata: { name: market.name, context: "datasheets" } });
    const endDwell = trackDwell({ metadata: { page: "datasheets_compare", marketSlug: params.slug } });
    return endDwell;
  }, [market?.id]);
  const schema = market?.schemaDefinition as DatasheetSchemaDefinition | undefined;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) { setLocation("/login"); throw new Error("Login required"); }
      if (!market) throw new Error("Market not loaded");
      const name = prompt("Name this comparison:", `${market.name} — ${new Date().toLocaleDateString()}`);
      if (!name) throw new Error("Cancelled");
      return await apiRequest("/api/me/datasheet-comparisons", "POST", { marketId: market.id, name, productIds: selectedIds });
    },
    onSuccess: () => toast({ title: "Comparison saved" }),
    onError: (err: unknown) => { if (err instanceof Error && err.message !== "Cancelled" && err.message !== "Login required") toast({ title: "Failed", description: err.message, variant: "destructive" }); },
  });

  if (!authLoading && !hasFeature("datasheets")) {
    return <LockedFeaturePanel featureKey="datasheets" variant="dark" />;
  }

  if (isLoading) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Loading…</div>;
  if (!marketDetail || !market || !schema) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Market not found.</div>;

  const toggle = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : prev.length < 5 ? [...prev, id] : prev);
  };

  const downloadExport = async (kind: "pdf" | "excel") => {
    const res = await fetch(`/api/datasheets/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ productIds: selectedIds }),
    });
    if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${market.slug}_comparison.${kind === "pdf" ? "pdf" : "xlsx"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-cyan-400 uppercase tracking-wider mb-1">Datasheet comparison</div>
            <h1 className="text-3xl font-bold">{market.name}</h1>
            {market.description && <p className="text-slate-400 mt-1 max-w-2xl text-sm">{market.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => saveMut.mutate()} disabled={selectedIds.length < 2} data-testid="button-save-comparison"><Bookmark className="h-4 w-4 mr-1" />Save</Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0"
              onClick={() => { if (!isAuthenticated) { setLocation("/login"); return; } setShowSendToRfp(true); }}
              disabled={selectedIds.length < 2}
              data-testid="button-send-to-rfp"
            >
              <Send className="h-4 w-4 mr-1" />Send to RFP
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport("pdf")} disabled={selectedIds.length < 2}><FileText className="h-4 w-4 mr-1" />PDF</Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport("excel")} disabled={selectedIds.length < 2}><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
          </div>
        </div>

        {/* Zone 1: Selector with filters */}
        <Card className="bg-slate-900 border-white/5 p-4 mb-6">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs text-slate-400">Choose up to 5 products to compare</div>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const vendors = Array.from(new Set(marketDetail.products.map(p => p.vendor.name))).sort();
                const subCats = Array.from(new Set(marketDetail.products.map(p => p.subCategory).filter(Boolean) as string[])).sort();
                const formFactors = Array.from(new Set(marketDetail.products.map(p => p.formFactor).filter(Boolean) as string[])).sort();
                const sel = "bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-slate-300";
                return (
                  <>
                    <select className={sel} value={filterVendor} onChange={e => { setFilterVendor(e.target.value); if (e.target.value) track("vendor_viewed", { metadata: { vendorName: e.target.value, context: "datasheets" } }); }} data-testid="filter-vendor">
                      <option value="">All vendors</option>
                      {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    {subCats.length > 0 && (
                      <select className={sel} value={filterSubCategory} onChange={e => { setFilterSubCategory(e.target.value); if (e.target.value) track("search_performed", { metadata: { facet: "subCategory", query: e.target.value, context: "datasheets" } }); }} data-testid="filter-subcategory">
                        <option value="">All sub-categories</option>
                        {subCats.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {formFactors.length > 0 && (
                      <select className={sel} value={filterFormFactor} onChange={e => { setFilterFormFactor(e.target.value); if (e.target.value) track("search_performed", { metadata: { facet: "formFactor", query: e.target.value, context: "datasheets" } }); }} data-testid="filter-formfactor">
                        <option value="">All form factors</option>
                        {formFactors.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {marketDetail.products
              .filter(p => !filterVendor || p.vendor.name === filterVendor)
              .filter(p => !filterSubCategory || p.subCategory === filterSubCategory)
              .filter(p => !filterFormFactor || p.formFactor === filterFormFactor)
              .map(p => {
                const active = selectedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`px-3 py-2 rounded-full text-sm border transition ${
                      active ? "bg-cyan-500 text-slate-950 border-cyan-500" : "border-white/10 hover:border-cyan-500/40 text-slate-300"
                    }`}
                    data-testid={`button-toggle-product-${p.slug}`}
                  >
                    <span className="font-medium">{p.vendor.name}</span> <span className="opacity-80">{p.name}</span>
                    {active && <X className="inline h-3 w-3 ml-1" />}
                  </button>
                );
              })}
            {marketDetail.products.length === 0 && <div className="text-sm text-slate-500">No products in this market yet.</div>}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Zone 2: Spec matrix */}
          <div className="lg:col-span-2">
            <SpecMatrix data={data} schema={schema} onProductClick={setPreviewProductId} />
          </div>
          {/* Zone 4: Chat */}
          <div>
            <ChatPanel
              market={market}
              selectedIds={selectedIds}
              isAuthenticated={isAuthenticated}
            />
          </div>
        </div>

        {/* Zone 3: PDF viewer modal — tabbed across selected products */}
        {previewProductId && data && (
          <PdfPreview
            datasheets={data.datasheets}
            productId={previewProductId}
            products={data.products}
            onClose={() => setPreviewProductId(null)}
          />
        )}

        {showSendToRfp && market && (
          <SendToRfpInline
            datasheetMarketName={market.name}
            productIds={selectedIds}
            onClose={() => setShowSendToRfp(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Spec matrix ──────────────────────────────────────────────────────────
function SpecMatrix({ data, schema, onProductClick }: { data: CompareData | undefined; schema: DatasheetSchemaDefinition; onProductClick: (id: string) => void }) {
  const specs = data?.specs ?? [];
  const specsByDs = useMemo(() => {
    const m = new Map<string, Map<string, DatasheetSpec>>();
    for (const s of specs) {
      const inner = m.get(s.datasheetId) ?? new Map();
      inner.set(`${s.categoryKey}.${s.attributeKey}`, s);
      m.set(s.datasheetId, inner);
    }
    return m;
  }, [specs]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (!data) return <Card className="bg-slate-900 border-white/5 p-6 text-slate-500">Select products to begin.</Card>;
  const { products, datasheets } = data;
  const dsByProduct = new Map(datasheets.map(d => [d.productId, d]));

  return (
    <Card className="bg-slate-900 border-white/5">
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 text-left p-3 text-xs uppercase text-slate-500 font-medium bg-slate-900 border-b border-white/5 min-w-[180px]">Attribute</th>
              {products.map(p => (
                <th key={p.id} className="sticky top-0 z-20 text-left p-3 text-xs uppercase text-slate-300 font-semibold min-w-[160px] bg-slate-900 border-b border-white/5">
                  <button onClick={() => onProductClick(p.id)} className="hover:text-cyan-300 text-left" data-testid={`button-preview-${p.slug}`}>
                    <div className="text-cyan-400 text-[10px] mb-0.5">{p.vendor.name}</div>
                    <div>{p.name}</div>
                    <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schema.groups.map(g => {
              const isCollapsed = !!collapsed[g.key];
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td
                      colSpan={products.length + 1}
                      className="bg-slate-950/60 px-3 py-2 text-xs font-semibold text-violet-300 uppercase tracking-wider cursor-pointer hover:bg-slate-950/80"
                      onClick={() => setCollapsed(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                      data-testid={`group-toggle-${g.key}`}
                    >
                      <span className="inline-block w-3">{isCollapsed ? "▸" : "▾"}</span> {g.label}
                    </td>
                  </tr>
                  {!isCollapsed && g.attributes.map(a => {
                    const values = products.map(p => {
                      const ds = dsByProduct.get(p.id);
                      return ds ? specsByDs.get(ds.id)?.get(`${g.key}.${a.key}`) : undefined;
                    });
                    const isDiff = computeDiff(values);
                    const winner = a.higherIsBetter !== undefined && a.type === "number" ? computeExtremumIdx(values, a.higherIsBetter, "best") : null;
                    const loser = a.higherIsBetter !== undefined && a.type === "number" ? computeExtremumIdx(values, a.higherIsBetter, "worst") : null;
                    return (
                      <tr key={`${g.key}-${a.key}`}>
                        <td className="sticky left-0 z-10 p-3 text-slate-300 bg-slate-900 border-t border-white/5">
                          <div className="font-medium">{a.label}</div>
                          {a.unit && <div className="text-xs text-slate-500">{a.unit}</div>}
                        </td>
                        {values.map((sp, i) => {
                          const tone =
                            winner === i ? "text-emerald-400 font-semibold" :
                            loser === i ? "text-rose-400 font-semibold" :
                            "text-slate-200";
                          return (
                            <td
                              key={i}
                              className={`p-3 border-t border-white/5 ${isDiff ? "bg-amber-500/5" : ""} ${tone}`}
                              title={sp?.sourceQuote ? `“${sp.sourceQuote}”${sp.sourcePage ? ` — p. ${sp.sourcePage}` : ""}` : undefined}
                            >
                              {sp?.rawValue ?? <span className="text-slate-600">—</span>}
                              {sp?.sourcePage && <div className="text-[10px] text-slate-500 mt-0.5">p. {sp.sourcePage}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function computeDiff(values: Array<DatasheetSpec | undefined>): boolean {
  const raws = values.map(v => v?.rawValue ?? null);
  const first = raws[0];
  return raws.some(r => r !== first);
}

function computeExtremumIdx(values: Array<DatasheetSpec | undefined>, higherIsBetter: boolean, which: "best" | "worst"): number | null {
  const nums: Array<{ i: number; n: number }> = [];
  values.forEach((v, i) => {
    if (v?.normalizedValue === null || v?.normalizedValue === undefined) return;
    const n = Number(v.normalizedValue);
    if (Number.isFinite(n)) nums.push({ i, n });
  });
  if (nums.length < 2) return null;
  const wantMax = (which === "best") === higherIsBetter; // best+higher=max, worst+higher=min, etc.
  let chosen = nums[0];
  for (const x of nums) {
    if (wantMax ? x.n > chosen.n : x.n < chosen.n) chosen = x;
  }
  return chosen.i;
}

// ── PDF preview modal (tabbed across selected products, react-pdf) ──────
// Sync-scroll toggle: OFF = single active tab; ON = grid of all PDFs all
// driven to the same page number so the user can compare matching pages
// across vendors side-by-side.
function PdfPreview({ datasheets, productId, onClose, products }: { datasheets: Datasheet[]; productId: string; onClose: () => void; products?: ProductWithVendor[] }) {
  const productList = (products ?? []).filter(p => datasheets.some(d => d.productId === p.id));
  const [activeId, setActiveId] = useState<string>(productId);
  const [syncScroll, setSyncScroll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});

  const visibleProducts = syncScroll ? productList : productList.filter(p => p.id === activeId);
  const visibleDs = visibleProducts
    .map(p => ({ p, ds: datasheets.find(d => d.productId === p.id) }))
    .filter((x): x is { p: ProductWithVendor; ds: Datasheet } => !!x.ds);

  const maxPages = Math.min(...visibleDs.map(({ p }) => pageCounts[p.id] ?? Infinity));
  const canGoNext = Number.isFinite(maxPages) ? page < maxPages : false;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-6xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-white/5 gap-2">
          <div className="flex gap-1 overflow-x-auto" data-testid="pdf-tabs">
            {productList.map(p => (
              <button
                key={p.id}
                onClick={() => { setActiveId(p.id); }}
                className={`px-3 py-1 rounded-md text-xs whitespace-nowrap border transition ${
                  activeId === p.id && !syncScroll ? "bg-cyan-500 text-slate-950 border-cyan-500" : "border-white/10 text-slate-300 hover:border-cyan-500/40"
                }`}
                data-testid={`pdf-tab-${p.slug}`}
                disabled={syncScroll}
              >
                <span className="font-medium">{p.vendor.name}</span> <span className="opacity-80">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <label className="flex items-center gap-1 cursor-pointer" data-testid="sync-scroll-toggle">
              <input type="checkbox" checked={syncScroll} onChange={e => setSyncScroll(e.target.checked)} />
              Sync scroll
            </label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">Page {page}{Number.isFinite(maxPages) ? ` / ${maxPages}` : ""}</span>
              <Button variant="ghost" size="sm" onClick={() => setPage(p => p + 1)} disabled={!canGoNext}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className={`flex-1 overflow-auto bg-slate-950 p-4 ${syncScroll ? "grid gap-4" : "flex justify-center"}`}
          style={syncScroll ? { gridTemplateColumns: `repeat(${visibleDs.length}, minmax(0, 1fr))` } : undefined}
        >
          {visibleDs.map(({ p, ds }) => (
            <div key={p.id} className="bg-white rounded-md shadow-md overflow-auto">
              <div className="px-2 py-1 text-[10px] bg-slate-100 text-slate-700 border-b">{p.vendor.name} · {p.name} · v{ds.version}</div>
              <Document
                file={ds.fileUrl}
                onLoadSuccess={({ numPages }) => setPageCounts(prev => ({ ...prev, [p.id]: numPages }))}
                loading={<div className="p-6 text-slate-500 text-xs">Loading PDF…</div>}
                error={<div className="p-6 text-rose-600 text-xs">Failed to load datasheet PDF. <a href={ds.fileUrl} target="_blank" rel="noreferrer" className="underline">Open directly</a></div>}
              >
                <Page pageNumber={Math.min(page, pageCounts[p.id] ?? page)} width={syncScroll ? 380 : 720} renderTextLayer={false} renderAnnotationLayer={false} />
              </Document>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Inline "Send to RFP" dialog from /datasheets/:slug ───────────────────
// Does the two-step canonical flow:
//   1. POST /api/me/rfps (existing endpoint with all user limits + checks)
//   2. POST /api/me/datasheet-comparisons/_inline_/seed-rfp — except this
//      endpoint is for saved comparisons, so we briefly persist one first.
function SendToRfpInline({ datasheetMarketName, productIds, onClose }: { datasheetMarketName: string; productIds: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const cleanName = datasheetMarketName.replace(/^ITMAP for /i, "").trim().toLowerCase();
  // Auto-default the RFP market by best-match against the datasheet market
  // name so the dialog is effectively one-click — the user can still edit
  // before confirming if the auto-match isn't right.
  const autoMarket = useMemo(() => {
    if (markets.length === 0) return "";
    const norm = (s: string) => s.replace(/^ITMAP for /i, "").trim().toLowerCase();
    const exact = markets.find(m => norm(m.name) === cleanName);
    if (exact) return exact.id;
    const partial = markets.find(m => norm(m.name).includes(cleanName) || cleanName.includes(norm(m.name)));
    return partial?.id ?? markets[0].id;
  }, [markets, cleanName]);
  const [rfpMarketId, setRfpMarketId] = useState("");
  useEffect(() => { if (!rfpMarketId && autoMarket) setRfpMarketId(autoMarket); }, [autoMarket, rfpMarketId]);
  const [title, setTitle] = useState(`RFP — ${datasheetMarketName.replace(/^ITMAP for /i, "")}`);

  const fullSendMut = useMutation({
    mutationFn: async () => {
      // Pull comparison context so we get the marketId server-side.
      const compareRes = await apiRequest("/api/datasheets/compare", "POST", { productIds });
      const compareData = await compareRes.json() as { products: Array<{ marketId: string }> };
      const dsMarketId = compareData.products[0]?.marketId;
      if (!dsMarketId) throw new Error("Could not resolve datasheet market");

      // 1. Persist comparison (re-validated by server).
      const savedRes = await apiRequest("/api/me/datasheet-comparisons", "POST", {
        marketId: dsMarketId,
        name: title,
        productIds,
      });
      const saved = await savedRes.json() as { id: string };

      // 2. Create the RFP through the canonical endpoint.
      const rfpRes = await apiRequest("/api/me/rfps", "POST", { marketId: rfpMarketId, title });
      const rfp = await rfpRes.json() as { id: string };

      // 3. Seed requirements from spec deltas.
      await apiRequest(`/api/me/datasheet-comparisons/${saved.id}/seed-rfp`, "POST", { rfpId: rfp.id });
      return rfp.id;
    },
    onSuccess: (rfpId) => {
      toast({ title: "RFP created" });
      window.location.href = `/me/rfps/${rfpId}`;
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Send {productIds.length} products to RFP Builder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm">RFP Market</label>
            <Select value={rfpMarketId} onValueChange={setRfpMarketId}>
              <SelectTrigger data-testid="select-rfp-market"><SelectValue placeholder="Select an RFP market" /></SelectTrigger>
              <SelectContent>
                {markets.map(m => <SelectItem key={m.id} value={m.id}>{m.name.replace(/^ITMAP for /i, "")}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">We'll seed quantitative must-have requirements from the best-in-class values in your spec matrix.</p>
          </div>
          <div>
            <label className="text-sm">RFP Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} data-testid="input-rfp-title" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => fullSendMut.mutate()} disabled={!rfpMarketId || !title || fullSendMut.isPending} data-testid="button-confirm-send-rfp">
            {fullSendMut.isPending ? "Creating…" : "Create RFP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Chat panel ───────────────────────────────────────────────────────────
function ChatPanel({ market, selectedIds, isAuthenticated }: { market: DatasheetMarket; selectedIds: string[]; isAuthenticated: boolean }) {
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  // When the user changes the pinned products, reset the conversation so
  // every subsequent answer is grounded in the current product scope rather
  // than the products pinned at conversation creation time.
  const selectedKey = selectedIds.join(",");
  useEffect(() => { setConversationId(null); }, [selectedKey]);

  const { data: convoData } = useQuery<{ conversation: DatasheetChatConversation; messages: DatasheetChatMessage[] }>({
    queryKey: ["/api/datasheets/chat/conversations", conversationId],
    queryFn: async () => (await apiRequest(`/api/datasheets/chat/conversations/${conversationId}`, "GET")).json(),
    enabled: !!conversationId,
  });

  const askMut = useMutation({
    mutationFn: async (q: string): Promise<{ conversationId: string }> => {
      let cid = conversationId;
      if (!cid) {
        const res = await apiRequest("/api/datasheets/chat/conversations", "POST", {
          marketId: market.id, productIds: selectedIds,
        });
        const c = await res.json();
        cid = c.id as string;
      }
      await apiRequest(`/api/datasheets/chat/conversations/${cid}/messages`, "POST", { question: q });
      return { conversationId: cid };
    },
    onSuccess: ({ conversationId: cid }) => {
      // Resolve to the actual conversation id returned from the mutation —
      // the local state may not yet reflect a brand-new conversation, so
      // setting state AND invalidating the resolved key both ensure the
      // assistant's reply appears after the first ask.
      if (conversationId !== cid) setConversationId(cid);
      queryClient.invalidateQueries({ queryKey: ["/api/datasheets/chat/conversations", cid] });
      setQuestion("");
    },
    onError: (err: unknown) => toast({ title: "Chat failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const send = () => {
    if (!isAuthenticated) { toast({ title: "Sign in to chat", description: "Log in or create an account to use the datasheet chat." }); return; }
    if (selectedIds.length < 2) { toast({ title: "Select at least 2 products" }); return; }
    if (!question.trim()) return;
    askMut.mutate(question.trim());
  };

  const messages = convoData?.messages ?? [];

  return (
    <Card className="bg-slate-900 border-white/5 flex flex-col h-[700px]">
      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-cyan-400" />
        <span className="text-sm font-medium">Ask the datasheets</span>
        {conversationId && (
          <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => setConversationId(null)}>
            <Plus className="h-3 w-3 mr-1" />New
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-slate-500">
            <p className="mb-2">Try asking:</p>
            <ul className="space-y-1 list-disc pl-4">
              <li>"Which has the highest IOPS?"</li>
              <li>"Compare power consumption."</li>
              <li>"What's the price-per-TB difference?"</li>
            </ul>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 ${m.role === "user" ? "bg-cyan-500/20 text-cyan-100" : "bg-slate-800 text-slate-200"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" && Array.isArray(m.citations) && (m.citations as DatasheetCitation[]).length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5 text-xs text-slate-400 space-y-1">
                  {(m.citations as DatasheetCitation[]).slice(0, 4).map((c, i) => (
                    <div key={i}><span className="text-cyan-400">{c.vendorName} {c.productName}</span>{c.page ? ` (p. ${c.page})` : ""}: "{c.quote}"</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {askMut.isPending && <div className="text-xs text-slate-500 animate-pulse">Thinking…</div>}
      </div>
      <div className="p-3 border-t border-white/5 flex gap-2">
        <Input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about these datasheets…"
          className="bg-slate-950 border-white/10"
          data-testid="input-chat-question"
        />
        <Button onClick={send} disabled={askMut.isPending || !question.trim()} data-testid="button-send-chat"><Send className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}
